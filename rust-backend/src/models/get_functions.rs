//! Get functions module
//!
//! This module was automatically extracted by Rusty Refactor.

use crate::{AnalysisState, FunctionInfo};

impl AnalysisState {
    /// Retrieves a vector of `FunctionInfo` instances representing all functions.
    ///
    /// # Returns
    /// A `Vec<FunctionInfo>` containing cloned instances of all functions stored in the state.
    ///
    /// # Examples
    /// 
    /// ```rust
    /// let analysis_state = AnalysisState::new();
    /// let functions = analysis_state.get_functions();
    /// ```
    pub fn get_functions(&self) -> Vec<FunctionInfo> {
        self.functions.values().cloned().collect()
    }
}