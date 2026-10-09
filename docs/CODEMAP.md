# Workspace Codemap & Subsystem Architecture

## 1. Directory Structure
```
DualClip/
├── docs/                     # Workspace governance & project documentation
│   ├── RULES.md              # Binding workspace rules & communication standards
│   ├── CODEMAP.md            # Directory layout & subsystem map
│   ├── STATE.md              # Active task tracking & whiteboard
│   ├── QUEUE.md              # Task batching inbox
│   ├── DECISIONS.md          # Architectural Decision Records (ADR)
│   ├── prompt.md             # Duo-agent handoff bridge file
│   ├── plans/                # Implementation plans
│   ├── audits/               # Code & design inspections
│   ├── knowledge/            # Permanent reference specs
│   ├── notes/                # Scratchpad & rough ideas
│   └── archive/              # Completed / retired docs
├── prototypes/               # UI Prototyping Sandbox
│   ├── sandbox/              # Tier 3 burner/throwaway sketches
│   └── preview.html          # Tier 2 full monolithic preview
├── sandbox_app/              # Isolated backend testing & experiment laboratory
└── backup/                   # Historical reference codebase (READ-ONLY)
```

## 2. Subsystem Overview
- **Documentation & Protocols**: `docs/`
- **UI Prototyping**: `prototypes/`
- **Backend Sandbox**: `sandbox_app/`
- **Reference Codebase**: `backup/`
