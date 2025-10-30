// Example Rust file to demonstrate Rusty Refactor capabilities
use std::collections::HashMap;

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

// Example 2: Struct with external dependencies
// Select this to see how imports are handled
pub struct Database {
    connections: HashMap<String, Connection>,
}

pub struct Connection {
    pub url: String,
    pub active: bool,
}

impl Database {
    pub fn new() -> Self {
        Database {
            connections: HashMap::new(),
        }
    }

    pub fn add_connection(&mut self, name: String, connection: Connection) {
        self.connections.insert(name, connection);
    }

    pub fn get_connection(&self, name: &str) -> Option<&Connection> {
        self.connections.get(name)
    }
}

// Example 3: Enum with trait implementation
// Select this enum and impl to extract together
#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    Active,
    Inactive,
    Pending,
    Suspended(String),
}

impl Status {
    pub fn is_active(&self) -> bool {
        matches!(self, Status::Active)
    }

    pub fn description(&self) -> String {
        match self {
            Status::Active => "Active".to_string(),
            Status::Inactive => "Inactive".to_string(),
            Status::Pending => "Pending".to_string(),
            Status::Suspended(reason) => format!("Suspended: {}", reason),
        }
    }
}

// Example 4: Generic struct
// Demonstrates handling of generic parameters
pub struct Container<T> {
    items: Vec<T>,
}

impl<T> Container<T> {
    pub fn new() -> Self {
        Container { items: Vec::new() }
    }

    pub fn add(&mut self, item: T) {
        self.items.push(item);
    }

    pub fn get(&self, index: usize) -> Option<&T> {
        self.items.get(index)
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

// Example 5: Trait definition
// Can be extracted with or without implementations
pub trait Authenticatable {
    fn authenticate(&self, password: &str) -> bool;
    fn reset_password(&mut self, new_password: String);
}

pub struct Account {
    username: String,
    password_hash: String,
}

impl Authenticatable for Account {
    fn authenticate(&self, password: &str) -> bool {
        // Simplified authentication
        self.password_hash == password
    }

    fn reset_password(&mut self, new_password: String) {
        self.password_hash = new_password;
    }
}

// Example 6: Multiple related structs
// Select all related types to keep them together
pub struct Order {
    pub id: u64,
    pub items: Vec<OrderItem>,
    pub total: f64,
}

pub struct OrderItem {
    pub product_id: u64,
    pub quantity: u32,
    pub price: f64,
}

impl Order {
    pub fn new(id: u64) -> Self {
        Order {
            id,
            items: Vec::new(),
            total: 0.0,
        }
    }

    pub fn add_item(&mut self, item: OrderItem) {
        self.total += item.price * item.quantity as f64;
        self.items.push(item);
    }

    pub fn calculate_total(&self) -> f64 {
        self.items
            .iter()
            .map(|item| item.price * item.quantity as f64)
            .sum()
    }
}

fn main() {
    // Example usage
    let user = User::new(1, "Alice".to_string(), "alice@example.com".to_string());
    println!("{}", user.display());

    let mut db = Database::new();
    db.add_connection(
        "primary".to_string(),
        Connection {
            url: "localhost:5432".to_string(),
            active: true,
        },
    );

    let status = Status::Active;
    println!("Status: {}", status.description());

    let mut container: Container<i32> = Container::new();
    container.add(42);
    println!("Container has {} items", container.len());
}
