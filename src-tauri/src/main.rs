// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // GTK's AT-SPI accessibility bridge (libatk-bridge-2.0) segfaults on
  // startup in environments without a running accessibility bus instead of
  // failing gracefully — this disables it before GTK initializes. Has to
  // happen this early: by the time `run()` touches any GTK/WebKit code the
  // bridge has already started connecting.
  #[cfg(target_os = "linux")]
  std::env::set_var("NO_AT_BRIDGE", "1");

  app_lib::run();
}
