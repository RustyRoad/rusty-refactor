use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;

// Re-export types from codetether_agent for our bridge
use codetether_agent::provider::{ProviderRegistry, CompletionRequest, Message, Role, ContentPart, ToolDefinition};
use codetether_agent::provider::parse_model_string;

#[napi]
fn greet(name: String) -> String {
    format!("Hello from Rust, {}!", name)
}

#[napi]
fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// Placeholder for future compiler-integration functions
#[napi]
fn analyze_placeholder(path: String) -> String {
    // For now, just return the path back so TS can validate the bridge
    format!("analyzed: {}", path)
}

#[napi(object)]
pub struct JsToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    pub thought_signature: Option<String>,
}

/// JavaScript representation of a chat message
#[napi(object)]
pub struct JsChatMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<JsToolCall>>,
    pub tool_call_id: Option<String>,
}

#[napi(object)]
pub struct JsToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: String, // Stringified JSON
}

#[napi(object)]
pub struct JsChatResponse {
    pub text: Option<String>,
    pub tool_calls: Option<Vec<JsToolCall>>,
}

/// List available models from codetether-agent
#[napi]
pub async fn codetether_list_models() -> Result<Vec<String>> {
    let registry = ProviderRegistry::from_vault()
        .await
        .map_err(|e| Error::from_reason(format!("Failed to load codetether registry: {}", e)))?;
        
    let mut model_strings = Vec::new();
    
    // For each provider
    for provider_name in registry.list() {
        if let Some(provider) = registry.get(provider_name) {
            match provider.list_models().await {
                Ok(models) => {
                    for m in models {
                        // Use provider/model format for proper resolution
                        model_strings.push(format!("{}/{}", provider_name, m.id));
                    }
                },
                Err(e) => {
                    // Log error but continue
                    eprintln!("Error listing models for provider {}: {}", provider_name, e);
                }
            }
        }
    }
    
    if model_strings.is_empty() {
        model_strings.push("default".to_string());
    }
    
    // Sort alphabetically
    model_strings.sort();
    
    Ok(model_strings)
}

/// Chat completion via codetether-agent (native bridge)
#[napi]
pub async fn codetether_chat(
    messages: Vec<JsChatMessage>,
    model: Option<String>,
    max_tokens: Option<i32>,
    temperature: Option<f64>,
    tools: Option<Vec<JsToolDefinition>>,
) -> Result<JsChatResponse> {
    // Load provider registry from vault (codetether config)
    let registry = ProviderRegistry::from_vault()
        .await
        .map_err(|e| Error::from_reason(format!("Failed to load codetether registry: {}", e)))?;
    
    let registry = Arc::new(registry);
    
    // Resolve model string (format: "provider/model" or just "model")
    let model_ref = model.unwrap_or_else(|| "default".to_string());
    let (provider_name_opt, model_name) = parse_model_string(&model_ref);
    
    // Resolve provider: either explicit (provider/model) or fallback to first available
    let provider = if let Some(provider_name) = provider_name_opt {
        registry.get(provider_name)
            .ok_or_else(|| Error::from_reason(format!("Provider '{}' not found in registry", provider_name)))?
    } else {
        // Fallback: use first available provider
        registry.list()
            .first()
            .and_then(|name| registry.get(name))
            .ok_or_else(|| Error::from_reason("No providers available in registry"))?
    };
    
    // Convert JS messages to codetether Message types
    let codetether_messages: Vec<Message> = messages
        .into_iter()
        .map(|msg| {
            let role = match msg.role.to_lowercase().as_str() {
                "system" => Role::System,
                "user" => Role::User,
                "assistant" => Role::Assistant,
                "tool" => Role::Tool,
                _ => Role::User, 
            };
            
            let mut parts = Vec::new();
            
            if role == Role::Tool {
                if let Some(content) = msg.content {
                    parts.push(ContentPart::ToolResult {
                        tool_call_id: msg.tool_call_id.unwrap_or_default(),
                        content,
                    });
                }
            } else if let Some(content) = msg.content {
                parts.push(ContentPart::Text { text: content });
            }
            
            if let Some(tool_calls) = msg.tool_calls {
                for tc in tool_calls {
                    parts.push(ContentPart::ToolCall {
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments,
                        thought_signature: tc.thought_signature,
                    });
                }
            }
            
            Message {
                role,
                content: parts,
            }
        })
        .collect();
        
    let codetether_tools: Vec<ToolDefinition> = tools
        .unwrap_or_default()
        .into_iter()
        .filter_map(|t| {
            match serde_json::from_str(&t.parameters) {
                Ok(params) => Some(ToolDefinition {
                    name: t.name,
                    description: t.description,
                    parameters: params,
                }),
                Err(_) => None
            }
        })
        .collect();
    
    // Build completion request
    let request = CompletionRequest {
        messages: codetether_messages,
        tools: codetether_tools,
        model: model_name.to_string(),
        max_tokens: max_tokens.map(|t| t as usize),
        temperature: temperature.map(|t| t as f32),
        top_p: None,
        stop: vec![],
    };
    
    // Execute completion
    let response = provider
        .complete(request)
        .await
        .map_err(|e| Error::from_reason(format!("Completion failed: {}", e)))?;
    
    let mut text_parts = Vec::new();
    let mut parsed_tool_calls = Vec::new();
    
    for part in response.message.content {
        match part {
            ContentPart::Text { text } => text_parts.push(text),
            ContentPart::ToolCall { id, name, arguments, thought_signature } => {
                parsed_tool_calls.push(JsToolCall {
                    id,
                    name,
                    arguments,
                    thought_signature,
                });
            }
            _ => {}
        }
    }
    
    Ok(JsChatResponse {
        text: if text_parts.is_empty() { None } else { Some(text_parts.join("")) },
        tool_calls: if parsed_tool_calls.is_empty() { None } else { Some(parsed_tool_calls) },
    })
}