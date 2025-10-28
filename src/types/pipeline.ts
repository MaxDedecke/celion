export interface Pipeline {
  id: string;
  migration_id: string;
  name: string;
  description?: string;
  source_data_source_id?: string;
  target_data_source_id?: string;
  source_system: string;
  target_system: string;
  execution_order: number;
  is_active: boolean;
  progress: number;
  objects_transferred: string;
  mapped_objects: string;
  workflow_type?: "manual" | "agent";
  is_mock?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithMappingCount extends Pipeline {
  mapping_count?: number;
}
