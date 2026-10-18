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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      candidates: {
        Row: {
          created_at: string
          data: Json
          id: string
          status: string
          tier: number
        }
        Insert: {
          created_at: string
          data: Json
          id: string
          status: string
          tier: number
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          status?: string
          tier?: number
        }
        Relationships: []
      }
      collection_meta: {
        Row: {
          name: string
          seeded_at: string
        }
        Insert: {
          name: string
          seeded_at?: string
        }
        Update: {
          name?: string
          seeded_at?: string
        }
        Relationships: []
      }
      dispatches: {
        Row: {
          created_at: string
          data: Json
          id: string
          lease_by: string | null
          lease_until: string | null
          processed_at: string | null
          source_id: string
          status: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          lease_by?: string | null
          lease_until?: string | null
          processed_at?: string | null
          source_id: string
          status?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          lease_by?: string | null
          lease_until?: string | null
          processed_at?: string | null
          source_id?: string
          status?: string
        }
        Relationships: []
      }
      drones: {
        Row: {
          data: Json
          domain: string
          id: string
          name: string
          origin: string
          updated_at: string
        }
        Insert: {
          data: Json
          domain: string
          id: string
          name: string
          origin: string
          updated_at?: string
        }
        Update: {
          data?: Json
          domain?: string
          id?: string
          name?: string
          origin?: string
          updated_at?: string
        }
        Relationships: []
      }
      procurements: {
        Row: {
          amount: string | null
          announced_at: string | null
          company: string
          country: string
          created_at: string
          currency: string | null
          customer: string | null
          data: Json
          id: string
          notes: string | null
          product: string | null
          program: string | null
          source: string
          source_url: string | null
        }
        Insert: {
          amount?: string | null
          announced_at?: string | null
          company: string
          country?: string
          created_at?: string
          currency?: string | null
          customer?: string | null
          data: Json
          id: string
          notes?: string | null
          product?: string | null
          program?: string | null
          source: string
          source_url?: string | null
        }
        Update: {
          amount?: string | null
          announced_at?: string | null
          company?: string
          country?: string
          created_at?: string
          currency?: string | null
          customer?: string | null
          data?: Json
          id?: string
          notes?: string | null
          product?: string | null
          program?: string | null
          source?: string
          source_url?: string | null
        }
        Relationships: []
      }
      sources: {
        Row: {
          data: Json
          handle: string
          id: string
          platform: string
          position: number
        }
        Insert: {
          data: Json
          handle: string
          id: string
          platform: string
          position?: number
        }
        Update: {
          data?: Json
          handle?: string
          id?: string
          platform?: string
          position?: number
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          last_result: Json | null
          last_sync: string
          name: string
        }
        Insert: {
          last_result?: Json | null
          last_sync: string
          name: string
        }
        Update: {
          last_result?: Json | null
          last_sync?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_dispatches: {
        Args: { p_lease_ms: number; p_limit: number; p_owner: string }
        Returns: string[]
      }
      release_dispatches: {
        Args: { p_ids: string[]; p_owner: string }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
