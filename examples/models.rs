//! Models module
//! 
//! This module contains data structures for the application.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: u32,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: u32,
    pub user_id: u32,
    pub status: String,
    pub created_at: String,
}

impl User {
    pub fn new(id: u32, name: String, email: String) -> Self {
        Self { id, name, email }
    }
}