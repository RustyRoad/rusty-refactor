//! User module
//!
//! This module was automatically extracted by Rusty Refactor.

// Example 1: Simple struct with methods
// Select this struct and impl block to extract to a module
pub struct User {
    pub id: u64,
    pub name: String,
    pub email: String,
}

impl User {
    pub fn new(id: u64, name: String, email: String) -> Self {
        User { id, name, email }
    }

    pub fn display(&self) -> String {
        format!("{} ({})", self.name, self.email)
    }

    pub fn update_email(&mut self, new_email: String) {
        self.email = new_email;
    }
}
