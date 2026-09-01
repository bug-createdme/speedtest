import { createApp } from "vue";
import VConsole from "vconsole";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";

// Khởi tạo VConsole để tiện kiểm tra log trên thiết bị/miniapp
if (typeof window !== "undefined") {
  try {
    new VConsole({ theme: "dark" });
  } catch (e) {
    console.warn("[speedtest] Failed to initialize VConsole", e);
  }
}

createApp(App).mount("#app");

