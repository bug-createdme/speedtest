import { createApp } from "vue";
import VConsole from "vconsole";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";

// VConsole - Tiện ích xem log, network và debug trực tiếp trên điện thoại / SuperApp
new VConsole({ theme: "dark" });

createApp(App).mount("#app");
