package dayoffs

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	TypeVacation    = "vacation"
	TypeSickLeave   = "sick_leave"
	TypePersonalDay = "personal_day"

	maxNoteLength = 1000
)

var (
	ErrNotFound   = errors.New("not found")
	ErrForbidden  = errors.New("forbidden")
	ErrConflict   = errors.New("conflict")
	ErrBadRequest = errors.New("bad request")
)

// Date is a calendar date that always serializes as YYYY-MM-DD. It deliberately
// carries no timezone semantics because dayoff ranges are date-only records.
type Date time.Time

func dateFromTime(value time.Time) Date {
	year, month, day := value.Date()
	return Date(time.Date(year, month, day, 0, 0, 0, 0, time.UTC))
}

func (d Date) String() string {
	return time.Time(d).Format(time.DateOnly)
}

func (d Date) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.String())
}

// Employee is an active person shown in the shared dayoffs calendar.
type Employee struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   string    `json:"avatar_url"`
}

// Dayoff is one inclusive leave range owned by a workspace user.
type Dayoff struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"user_id"`
	Type      string    `json:"type"`
	StartDate Date      `json:"start_date"`
	EndDate   Date      `json:"end_date"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MonthResponse contains both the active employee list and all records that
// intersect the requested month. Empty employees or records are represented as
// JSON arrays, rather than null, for the calendar client.
type MonthResponse struct {
	Employees []Employee `json:"employees"`
	Records   []Dayoff   `json:"records"`
}

type CreateParams struct {
	UserID    *uuid.UUID
	Type      string
	StartDate string
	EndDate   string
	Note      string
	ActorID   uuid.UUID
	ActorRole string
}

type UpdateParams struct {
	UserID    *uuid.UUID
	Type      string
	StartDate string
	EndDate   string
	Note      string
	ActorID   uuid.UUID
	ActorRole string
}
