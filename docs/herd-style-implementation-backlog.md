# Exedeck Herd-Style Expansion Backlog

## How To Use This Backlog

- Priority order is top to bottom.
- Each epic includes implementation tickets with acceptance criteria.
- Estimate labels are relative: `S` (small), `M` (medium), `L` (large).

## Milestone 1: Project Provisioning Foundation

### Epic 1: Schema and Domain Model (`M`)

Goal: Add project-level metadata so Exedeck can manage stack-specific behavior.

Tickets:

1. Add schema v3 for project metadata (`S`)
- Add `project.kind` (`laravel | node | custom`)
- Add `project.services` (initially optional map/object)
- Acceptance:
  - Existing configs load without errors
  - New configs persist v3 fields

2. Add migration from v2 to v3 (`S`)
- Map existing projects to `kind: custom`
- Preserve existing task behavior
- Acceptance:
  - No data loss in projects/tasks after migration
  - Re-saving config does not mutate unrelated fields

3. Extend shared types + preload API contracts (`S`)
- Update shared TS interfaces for new fields
- Keep renderer/main compile-safe
- Acceptance:
  - `npm run typecheck` passes

Dependencies: none

---

### Epic 2: Background Job Runtime (`L`)

Goal: Run one-off provisioning commands asynchronously with logs + status.

Tickets:

1. Implement `jobManager` in main process (`M`)
- Lifecycle states: `queued | running | success | failed | canceled`
- Capture stdout/stderr stream
- Keep in-memory job registry
- Acceptance:
  - Job can be started and queried by id
  - Job status transitions are deterministic

2. Add provisioning IPC endpoints (`M`)
- `project:create`
- `project:create:status`
- `project:create:cancel`
- Acceptance:
  - Renderer can start, poll/subscribe, and cancel jobs
  - Failed jobs return useful error payloads

3. Add event channel(s) for live job output (`S`)
- Example: `job:data`, `job:status`
- Acceptance:
  - Output appears live in UI
  - Completed jobs remain inspectable for current session

Dependencies: Epic 1

---

### Epic 3: Initial Provisioners (Laravel + Node) (`L`)

Goal: Create projects through stack-aware command templates.

Tickets:

1. Laravel provisioner (`M`)
- Primary command: `laravel new <name>`
- Fallback path if CLI unavailable (composer strategy or actionable error)
- Acceptance:
  - Successful job creates expected directory
  - Failures include remediation guidance

2. Node provisioner (`M`)
- Template options (start with one default, e.g. Vite)
- Commands support npm/pnpm/yarn selection (initially default to npm)
- Acceptance:
  - Successful Node project scaffold for default template
  - Command logs visible in job output

3. Post-provision project registration (`S`)
- Add project to config after successful scaffold
- Attach default stack-specific tasks
- Acceptance:
  - New project appears in sidebar automatically
  - Tasks can be started immediately

Dependencies: Epic 2

---

### Epic 4: Minimal UI for Create Project Flow (`M`)

Goal: Expose provisioning in product with clear status UX.

Tickets:

1. Add "Create Project" entry point (`S`)
- Toolbar/menu button and modal/sheet
- Inputs: name, path, stack, package manager (optional)
- Acceptance:
  - User can start a provisioning job without opening raw settings

2. Add job progress panel (`M`)
- Live output terminal/log view
- Status and cancel action
- Acceptance:
  - User sees real-time feedback
  - Cancel updates UI and state correctly

3. Error UX and retries (`S`)
- Show failure reason and quick retry path
- Acceptance:
  - Failed runs are diagnosable without devtools

Dependencies: Epics 2, 3

## Milestone 2: Smart Project Setup

### Epic 5: Detection + Template Generation (`M`)

Goal: Auto-detect project type and generate practical starter tasks.

Tickets:

1. Filesystem detectors (`S`)
- Laravel via `artisan` + `composer.json`
- Node via `package.json`
- Acceptance:
  - Existing directories can be classified reliably

2. Task template registry (`M`)
- `laravel`, `node`, `custom` templates
- User can opt in/out per template task
- Acceptance:
  - Generated tasks are editable and persisted

Dependencies: Milestone 1

---

### Epic 6: Service Metadata + Runtime Binding (`M`)

Goal: Make services first-class so monitoring/routing can attach to them.

Tickets:

1. Define service descriptors (`S`)
- Example: `{ type, commandRef, port, enabled }`
- Acceptance:
  - Services persist in config and remain backward compatible

2. Bind tasks to services (`S`)
- Map task ids to service roles
- Acceptance:
  - UI can display "web", "queue", etc. per project

Dependencies: Epic 1, Epic 5

## Milestone 3: Site Routing and Monitoring

### Epic 7: Internal Reverse Proxy (Portable MVP) (`L`)

Goal: Route local hostnames to project web services without requiring system Nginx.

Tickets:

1. Implement internal proxy worker (`M`)
- Hostname -> upstream port mapping
- Health check/reload on mapping changes
- Acceptance:
  - Requests resolve to correct project service

2. Domain management UI (`M`)
- Add/edit/remove local domains per project
- Validation for conflicts
- Acceptance:
  - Domain changes take effect without restarting app

Dependencies: Epic 6

---

### Epic 8: Nginx Provider (Herd Parity Path) (`L`)

Goal: Allow Exedeck to manage Nginx config safely.

Tickets:

1. Provider interface for routing backends (`S`)
- `internal`, `nginx` providers behind common contract
- Acceptance:
  - Provider switch does not alter project model

2. Nginx config writer + validator (`M`)
- Render site config files from project domains/services
- Validate before reload
- Acceptance:
  - Invalid config never triggers reload
  - Rollback strategy is defined

3. Nginx reload integration (`M`)
- Controlled reload command and result reporting
- Acceptance:
  - Success/failure surfaced in UI with actionable details

Dependencies: Epic 7

---

### Epic 9: Monitoring Panels (`L`)

Goal: Provide useful visibility similar to Herd’s operational views.

Tickets:

1. Log streams by service (`M`)
- Structured grouping by project/service
- Search/filter recent logs
- Acceptance:
  - User can isolate queue/web logs quickly

2. Queue/mail health probes (`M`)
- Command probes and status indicators
- Acceptance:
  - Health state updates at interval and handles failures gracefully

3. Alerting surface (`S`)
- Basic warnings for crashed critical services
- Acceptance:
  - User sees alert without opening each task

Dependencies: Epics 5, 6

## Cross-Cutting Work

### Epic 10: Reliability, Security, and Testing (`L`)

Tickets:

1. Command execution safety checks (`M`)
- Path validation, command allowlist strategy where appropriate
- Acceptance:
  - Provisioning rejects unsafe or malformed inputs

2. Integration test coverage (`M`)
- Config migration tests
- Job lifecycle tests
- Provisioner success/failure paths
- Acceptance:
  - Core flows covered in CI

3. Telemetry/logging for diagnostics (`S`)
- Internal app logs for job/routing failures
- Acceptance:
  - Support debugging without attaching debugger

Dependencies: parallel across milestones

## Suggested Sprint Order

1. Sprint 1:
- Epic 1
- Epic 2 (ticket 1 + 2)

2. Sprint 2:
- Epic 2 (ticket 3)
- Epic 3
- Epic 4

3. Sprint 3:
- Epic 5
- Epic 6

4. Sprint 4+:
- Epic 7
- Epic 8 (optional, depending on parity goals)
- Epic 9
- Epic 10 ongoing

## Definition of Done (Program Level)

- User can create Laravel or Node projects in background with live progress.
- Created projects appear as first-class managed entities with starter tasks/services.
- At least one routing provider works end-to-end.
- Monitoring surface gives practical operational visibility (logs + service health).
- Migration and provisioning paths are covered by automated tests.

