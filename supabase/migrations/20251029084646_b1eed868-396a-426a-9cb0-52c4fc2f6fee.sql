-- Add workflow_type column to pipelines table
ALTER TABLE pipelines 
ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'manual' CHECK (workflow_type IN ('manual', 'agent'));

-- Create agent_workflow_states table to persist agent workflow data
CREATE TABLE agent_workflow_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  briefing TEXT NOT NULL DEFAULT '',
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_running BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pipeline_id)
);

-- Enable RLS on agent_workflow_states
ALTER TABLE agent_workflow_states ENABLE ROW LEVEL SECURITY;

-- RLS policies for agent_workflow_states
CREATE POLICY "Users can view agent states of their pipelines"
ON agent_workflow_states
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    JOIN migrations m ON m.id = p.migration_id
    WHERE p.id = agent_workflow_states.pipeline_id
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create agent states for their pipelines"
ON agent_workflow_states
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM pipelines p
    JOIN migrations m ON m.id = p.migration_id
    WHERE p.id = agent_workflow_states.pipeline_id
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update agent states of their pipelines"
ON agent_workflow_states
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    JOIN migrations m ON m.id = p.migration_id
    WHERE p.id = agent_workflow_states.pipeline_id
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete agent states of their pipelines"
ON agent_workflow_states
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM pipelines p
    JOIN migrations m ON m.id = p.migration_id
    WHERE p.id = agent_workflow_states.pipeline_id
    AND m.user_id = auth.uid()
  )
);

-- Add trigger for updated_at on agent_workflow_states
CREATE TRIGGER update_agent_workflow_states_updated_at
BEFORE UPDATE ON agent_workflow_states
FOR EACH ROW
EXECUTE FUNCTION handle_updated_at();