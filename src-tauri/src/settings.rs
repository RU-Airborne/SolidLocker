use std::path::PathBuf;

use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};
use crate::PRODUCT_DIR;

/// %APPDATA%\SolidLocker\settings.json, a clean product-name folder instead of
/// Tauri's default bundle-identifier folder (%APPDATA%\com.solidlocker.app).
fn store_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .data_dir()
        .map_err(|e| AppError::new("STORE", e.to_string()))?
        .join(PRODUCT_DIR);
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    Ok(dir.join("settings.json"))
}

pub fn get_string(app: &AppHandle, key: &str) -> AppResult<Option<String>> {
    let store = app
        .store(store_path(app)?)
        .map_err(|e| AppError::new("STORE", e.to_string()))?;
    Ok(store.get(key).and_then(|v| v.as_str().map(String::from)))
}

pub fn set_string(app: &AppHandle, key: &str, value: &str) -> AppResult<()> {
    let store = app
        .store(store_path(app)?)
        .map_err(|e| AppError::new("STORE", e.to_string()))?;
    store.set(key, json!(value));
    store
        .save()
        .map_err(|e| AppError::new("STORE", e.to_string()))
}

pub fn delete_key(app: &AppHandle, key: &str) -> AppResult<()> {
    let store = app
        .store(store_path(app)?)
        .map_err(|e| AppError::new("STORE", e.to_string()))?;
    store.delete(key);
    store
        .save()
        .map_err(|e| AppError::new("STORE", e.to_string()))
}
