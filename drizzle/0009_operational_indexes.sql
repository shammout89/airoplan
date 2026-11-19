CREATE INDEX records_scope_kind ON records(owner,kind,id);
--> statement-breakpoint
CREATE INDEX extension_scope_state ON extension_items(workspace_id,kind,state,updated);
--> statement-breakpoint
CREATE INDEX planning_scope_kind ON planning_items(workspace_id,kind,state,updated);
--> statement-breakpoint
CREATE INDEX flights_scope_departure ON flights(workspace_id,departure,id);
--> statement-breakpoint
CREATE INDEX settings_scope_version ON settings_versions(workspace_id,kind,code,created);
