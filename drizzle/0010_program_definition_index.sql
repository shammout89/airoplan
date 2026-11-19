CREATE INDEX IF NOT EXISTS extension_program_definition_idx ON extension_items(workspace_id,kind,json_extract(data,'$.programId'),code);
