package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"

	"msgnr/internal/admin"
	"msgnr/internal/auth"
	"msgnr/internal/bootstrap"
	"msgnr/internal/calls"
	"msgnr/internal/chat"
	"msgnr/internal/config"
	"msgnr/internal/database"
	"msgnr/internal/events"
	"msgnr/internal/logger"
	"msgnr/internal/storage"
	syncsvc "msgnr/internal/sync"
	"msgnr/internal/tasks"
	"msgnr/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic("failed to load config: " + err.Error())
	}

	if err := logger.Init(cfg.IsDev()); err != nil {
		panic("failed to initialise logger: " + err.Error())
	}
	defer logger.Sync()

	log := logger.Logger

	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	// Auth components
	tokenMgr := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTAccessTokenTTL)
	sessionRepo := auth.NewRefreshSessionRepo(db.Pool)
	userRepo := auth.NewUserRepo(db.Pool)
	authSvc := auth.NewService(tokenMgr, sessionRepo, userRepo, db.Pool, cfg.JWTRefreshTokenTTL, log)
	authHandler := auth.NewHandler(authSvc)

	// Event pipeline
	eventStore := events.NewStore(db.Pool)
	eventBus := events.NewBus(log)
	listenerCfg := events.ListenerConfig{
		DSN:             cfg.DatabaseURL,
		CatchUpBatch:    cfg.EventListenerCatchupBatch,
		RetryBackoff:    cfg.EventListenerRetryBackoff,
		RetryBackoffMax: 10 * time.Second,
	}
	eventListener := events.NewListener(listenerCfg, eventStore, eventBus, log)

	listenerCtx, listenerCancel := context.WithCancel(context.Background())
	listenerStopped := make(chan struct{})
	go func() {
		defer close(listenerStopped)
		eventListener.Run(listenerCtx)
	}()

	chatSvc := chat.NewService(db.Pool, eventStore)
	chatSvc.SetLogger(log)
	chatHandler := chat.NewHandler(chatSvc, authSvc, cfg)
	callSvc := calls.NewService(db.Pool, eventStore, cfg)
	callHandler := calls.NewHandler(callSvc)
	bootstrapSvc := bootstrap.NewService(db.Pool, cfg)
	syncSvc := syncsvc.NewService(db.Pool, cfg, eventStore)

	wsServer := ws.NewServer(db, cfg, authSvc, bootstrapSvc, callSvc, chatSvc, syncSvc, eventBus)
	chatHandler.SetNotifier(wsServer)

	callExpiryCtx, callExpiryCancel := context.WithCancel(context.Background())
	callExpiryDone := make(chan struct{})
	go func() {
		defer close(callExpiryDone)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-callExpiryCtx.Done():
				return
			case <-ticker.C:
				runCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				result, err := callSvc.ExpireInvites(runCtx)
				cancel()
				if err != nil {
					log.Warn("Call invite expiry sweep failed", zap.Error(err))
					continue
				}
				if len(result.DirectDeliveries) > 0 {
					wsServer.SendCallDirectServerEvents(result.DirectDeliveries)
				}
			}
		}
	}()

	adminSvc := admin.NewService(db.Pool)
	adminHandler := admin.NewHandler(adminSvc, authSvc, wsServer, log)

	storageClient, err := storage.New(cfg)
	if err != nil {
		log.Fatal("Failed to connect to Minio", zap.Error(err))
	}
	authSvc.ConfigureAvatars(storageClient, cfg.AvatarMaxSizeMB, eventStore)
	chatSvc.ConfigureAttachments(storageClient, cfg.AttachmentMaxSizeMB)

	tasksSvc := tasks.NewService(db.Pool, storageClient)
	tasksHandler := tasks.NewHandler(tasksSvc, authSvc, log, cfg.AttachmentMaxSizeMB)

	// --- main HTTP mux ---
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsServer.Handler())
	mux.HandleFunc("/health", livenessHandler())
	mux.HandleFunc("/ready", readinessHandler(db))
	authHandler.RegisterRoutes(mux)
	chatHandler.RegisterRoutes(mux)
	callHandler.RegisterRoutes(mux)
	adminHandler.RegisterRoutes(mux)
	tasksHandler.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  cfg.HTTPReadTimeout,
		WriteTimeout: cfg.HTTPWriteTimeout,
		IdleTimeout:  cfg.HTTPIdleTimeout,
	}

	// --- metrics HTTP server (separate port) ---
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())

	metricsServer := &http.Server{
		Addr:         ":" + cfg.MetricsPort,
		Handler:      metricsMux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("HTTP server listening", zap.String("addr", httpServer.Addr))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		log.Info("Metrics server listening", zap.String("addr", metricsServer.Addr))
		if err := metricsServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("Metrics server error", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info("Received signal, shutting down", zap.String("signal", sig.String()))

	shutCtx, shutCancel := context.WithTimeout(context.Background(), cfg.HTTPShutdownTimeout)
	defer shutCancel()

	if err := httpServer.Shutdown(shutCtx); err != nil {
		log.Error("HTTP server forced shutdown", zap.Error(err))
	}
	if err := metricsServer.Shutdown(shutCtx); err != nil {
		log.Error("Metrics server forced shutdown", zap.Error(err))
	}

	// Stop the event listener and wait for its goroutine to exit.
	callExpiryCancel()
	<-callExpiryDone
	listenerCancel()
	<-listenerStopped

	log.Info("Server exited cleanly")
}

func livenessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}
}

func readinessHandler(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := db.HealthCheck(ctx); err != nil {
			http.Error(w, `{"status":"not_ready","db":"error"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready"}`))
	}
}
