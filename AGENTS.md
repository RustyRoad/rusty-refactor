# AGENTS.md

These rules are mandatory for every agent and contributor working in this
repository. Treat them as hard requirements, not suggestions.

## Hard Rules

1. **Single Responsibility Principle (SRP) is mandatory.**
   - Every module, type, function, method, and file must have one clear
     reason to change.
   - Do not mix unrelated concerns such as parsing, validation, persistence,
     formatting, UI, logging, and transport in the same unit.
   - If a unit needs the word "and" to describe its purpose, split it.

2. **Prefer small, cohesive modules.**
   - Code must be grouped by behavior and responsibility, not by convenience.
   - Keep public APIs narrow and intentional.
   - Hide implementation details behind focused interfaces, traits, classes,
     or helper modules.
   - Do not create utility dumping grounds. A helper must belong to a clear
     domain or responsibility.

3. **Maximize cohesion.**
   - Things that change together should live together.
   - Things that change for different reasons must be separated.
   - Avoid files that contain multiple unrelated workflows.
   - Avoid functions that operate at multiple abstraction levels.

4. **Documentation is required on all methods and functions.**
   - Every public and private method/function must have documentation that
     explains its purpose.
   - Documentation must describe non-obvious inputs, outputs, side effects,
     error cases, and invariants.
   - Do not document by restating the name. Explain why the method exists and
     how it fits its responsibility.
   - Keep documentation current when behavior changes.

5. **Line length is limited to 80 characters.**
   - All source code, comments, and documentation must wrap at 80 columns.
   - Prefer clearer names and extracted helpers over long expressions.
   - Long strings may be split when the language supports it.
   - Generated files are exempt only when manually wrapping them is unsafe.

## Design Requirements

- A file should represent one cohesive concept or closely related set of
  operations.
- A function should perform one action at one abstraction level.
- A method should belong only on a type whose core responsibility needs it.
- Prefer composition over large inheritance or god objects.
- Prefer explicit dependencies over hidden global state.
- Prefer pure functions where practical.
- Keep side effects isolated and named clearly.

## Refactoring Requirements

When modifying existing code:

1. Preserve behavior unless the task explicitly requires behavior changes.
2. Split oversized or multi-purpose units before adding new complexity.
3. Add or update documentation for every method/function touched.
4. Enforce the 80-character line limit in all changed lines.
5. Leave nearby code more cohesive when practical.

## Review Checklist

Before considering work complete, verify:

- [ ] Each changed file has a clear responsibility.
- [ ] Each changed function/method has exactly one primary purpose.
- [ ] Related logic is grouped together and unrelated logic is separated.
- [ ] Every method/function has useful documentation.
- [ ] No manually written line exceeds 80 characters.
- [ ] No new catch-all utility modules, god objects, or mixed concerns exist.
- [ ] Public APIs are minimal and intentional.

Violations of these rules must be fixed before the work is considered done.
