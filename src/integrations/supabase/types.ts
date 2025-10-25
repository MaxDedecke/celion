export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      connectors: {
        Row: {
          additional_config: Json | null
          api_key: string | null
          api_url: string | null
          auth_type: string
          connector_type: string
          created_at: string
          endpoint: string | null
          id: string
          is_tested: boolean
          migration_id: string
          password: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          additional_config?: Json | null
          api_key?: string | null
          api_url?: string | null
          auth_type?: string
          connector_type: string
          created_at?: string
          endpoint?: string | null
          id?: string
          is_tested?: boolean
          migration_id: string
          password?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          additional_config?: Json | null
          api_key?: string | null
          api_url?: string | null
          auth_type?: string
          connector_type?: string
          created_at?: string
          endpoint?: string | null
          id?: string
          is_tested?: boolean
          migration_id?: string
          password?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connectors_migration_id_fkey"
            columns: ["migration_id"]
            isOneToOne: false
            referencedRelation: "migrations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_projects: {
        Row: {
          created_at: string
          data_source_id: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          data_source_id: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          data_source_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_projects_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          additional_config: Json | null
          api_key: string | null
          api_url: string | null
          auth_type: string
          created_at: string
          id: string
          is_active: boolean
          is_global: boolean
          name: string
          password: string | null
          source_type: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          additional_config?: Json | null
          api_key?: string | null
          api_url?: string | null
          auth_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_global?: boolean
          name: string
          password?: string | null
          source_type: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          additional_config?: Json | null
          api_key?: string | null
          api_url?: string | null
          auth_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_global?: boolean
          name?: string
          password?: string | null
          source_type?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      field_mappings: {
        Row: {
          collection_item_field_id: string | null
          created_at: string
          description: string | null
          id: string
          join_with: string | null
          mapping_type: string
          migration_id: string
          source_field_id: string
          source_object_type: string
          target_field_id: string
          target_object_type: string
          updated_at: string
        }
        Insert: {
          collection_item_field_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          join_with?: string | null
          mapping_type?: string
          migration_id: string
          source_field_id: string
          source_object_type: string
          target_field_id: string
          target_object_type: string
          updated_at?: string
        }
        Update: {
          collection_item_field_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          join_with?: string | null
          mapping_type?: string
          migration_id?: string
          source_field_id?: string
          source_object_type?: string
          target_field_id?: string
          target_object_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_mappings_migration_id_fkey"
            columns: ["migration_id"]
            isOneToOne: false
            referencedRelation: "migrations"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_activities: {
        Row: {
          created_at: string
          id: string
          migration_id: string
          timestamp: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          migration_id: string
          timestamp: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          migration_id?: string
          timestamp?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_activities_migration_id_fkey"
            columns: ["migration_id"]
            isOneToOne: false
            referencedRelation: "migrations"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          created_at: string
          id: string
          in_connector: string
          in_connector_detail: string
          mapped_objects: string
          meta_model_approved: boolean
          name: string
          objects_transferred: string
          out_connector: string
          out_connector_detail: string
          progress: number
          project_id: string | null
          source_system: string
          target_system: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_connector: string
          in_connector_detail: string
          mapped_objects?: string
          meta_model_approved?: boolean
          name: string
          objects_transferred?: string
          out_connector: string
          out_connector_detail: string
          progress?: number
          project_id?: string | null
          source_system: string
          target_system: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          in_connector?: string
          in_connector_detail?: string
          mapped_objects?: string
          meta_model_approved?: boolean
          name?: string
          objects_transferred?: string
          out_connector?: string
          out_connector_detail?: string
          progress?: number
          project_id?: string | null
          source_system?: string
          target_system?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "migrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
