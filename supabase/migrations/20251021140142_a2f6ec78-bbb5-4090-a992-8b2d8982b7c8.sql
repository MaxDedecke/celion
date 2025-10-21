-- Update RLS policies for migrations to allow migrations without projects

-- Drop existing policies
DROP POLICY IF EXISTS "Users can create migrations in their projects" ON migrations;
DROP POLICY IF EXISTS "Users can view migrations in their projects" ON migrations;
DROP POLICY IF EXISTS "Users can update migrations in their projects" ON migrations;
DROP POLICY IF EXISTS "Users can delete migrations in their projects" ON migrations;

-- Create new policies that handle both project-based and standalone migrations
CREATE POLICY "Users can create their own migrations"
ON migrations FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND
  (project_id IS NULL OR EXISTS (
    SELECT 1 FROM projects 
    WHERE projects.id = migrations.project_id 
    AND projects.user_id = auth.uid()
  ))
);

CREATE POLICY "Users can view their own migrations"
ON migrations FOR SELECT
USING (
  auth.uid() = user_id
);

CREATE POLICY "Users can update their own migrations"
ON migrations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own migrations"
ON migrations FOR DELETE
USING (auth.uid() = user_id);