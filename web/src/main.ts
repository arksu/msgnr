import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import 'emoji-mart-vue-fast/css/emoji-mart.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
