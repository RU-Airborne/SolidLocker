//! Serializes everything that writes to the working tree to reduce the risks of a race condition. 
//! Tauri runs commands concurrently, clicking branch switching and locking at the same time would
//!  race over the same index and file.

use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::{Mutex, MutexGuard};

#[derive(Default)]
pub struct RepoGate {
    tree: Mutex<()>,
    switching: AtomicBool,
}

/// Held for the length of a branch switch
pub struct SwitchGuard<'a> {
    _tree: MutexGuard<'a, ()>,
    switching: &'a AtomicBool,
}

impl Drop for SwitchGuard<'_> {
    fn drop(&mut self) {
        self.switching.store(false, Ordering::SeqCst);
    }
}

impl RepoGate {
    pub async fn exclusive(&self) -> MutexGuard<'_, ()> {
        self.tree.lock().await
    }

    /// Take the tree only if it is free. `None` means "someone is working
    pub fn try_exclusive(&self) -> Option<MutexGuard<'_, ()>> {
        self.tree.try_lock().ok()
    }

    pub async fn exclusive_switch(&self) -> SwitchGuard<'_> {
        let tree = self.tree.lock().await;
        self.switching.store(true, Ordering::SeqCst);
        SwitchGuard {
            _tree: tree,
            switching: &self.switching,
        }
    }

    pub fn is_switching(&self) -> bool {
        self.switching.load(Ordering::SeqCst)
    }
}
