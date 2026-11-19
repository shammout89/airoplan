CREATE UNIQUE INDEX `aircraft_reference_name` ON `extension_items` (`workspace_id`, json_extract(`data`,'$.type'), COALESCE(json_extract(`data`,'$.parentId'),''), json_extract(`data`,'$.nameKey')) WHERE `kind`='aircraft_reference';
--> statement-breakpoint
CREATE UNIQUE INDEX `aircraft_reference_code` ON `extension_items` (`workspace_id`, json_extract(`data`,'$.type'), COALESCE(json_extract(`data`,'$.parentId'),''), json_extract(`data`,'$.codeKey')) WHERE `kind`='aircraft_reference' AND json_extract(`data`,'$.codeKey')<>'';
