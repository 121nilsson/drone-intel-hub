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
      ai_token_usage: {
        Row: {
          calls: number
          day: string
          input: number
          output: number
          purpose: string
        }
        Insert: {
          calls?: number
          day: string
          input?: number
          output?: number
          purpose: string
        }
        Update: {
          calls?: number
          day?: string
          input?: number
          output?: number
          purpose?: string
        }
        Relationships: []
      }
      autonomy_events: {
        Row: {
          action: string
          actor: string
          actor_kind: string
          after: Json | null
          at: string
          before: Json | null
          category: string | null
          checks: Json | null
          confidence: number | null
          correlation_id: string | null
          id: string
          reason: string | null
          reversed_by: string | null
          reversible: boolean
          target_collection: string
          target_id: string
          verdict: string | null
        }
        Insert: {
          action: string
          actor: string
          actor_kind: string
          after?: Json | null
          at?: string
          before?: Json | null
          category?: string | null
          checks?: Json | null
          confidence?: number | null
          correlation_id?: string | null
          id?: string
          reason?: string | null
          reversed_by?: string | null
          reversible?: boolean
          target_collection: string
          target_id: string
          verdict?: string | null
        }
        Update: {
          action?: string
          actor?: string
          actor_kind?: string
          after?: Json | null
          at?: string
          before?: Json | null
          category?: string | null
          checks?: Json | null
          confidence?: number | null
          correlation_id?: string | null
          id?: string
          reason?: string | null
          reversed_by?: string | null
          reversible?: boolean
          target_collection?: string
          target_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autonomy_events_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "autonomy_events"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          created_at: string
          data: Json
          id: string
          rev: number
          status: string
          tier: number
        }
        Insert: {
          created_at: string
          data: Json
          id: string
          rev?: number
          status: string
          tier: number
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          rev?: number
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
          content_hash: string | null
          created_at: string
          data: Json
          id: string
          lease_by: string | null
          lease_until: string | null
          processed_at: string | null
          rev: number
          source_id: string
          status: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          data: Json
          id: string
          lease_by?: string | null
          lease_until?: string | null
          processed_at?: string | null
          rev?: number
          source_id: string
          status?: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          data?: Json
          id?: string
          lease_by?: string | null
          lease_until?: string | null
          processed_at?: string | null
          rev?: number
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
          rev: number
          updated_at: string
        }
        Insert: {
          data: Json
          domain: string
          id: string
          name: string
          origin: string
          rev?: number
          updated_at?: string
        }
        Update: {
          data?: Json
          domain?: string
          id?: string
          name?: string
          origin?: string
          rev?: number
          updated_at?: string
        }
        Relationships: []
      }
      dynamic_rules: {
        Row: {
          created_at: string
          decided_by: string
          evidence: Json | null
          id: string
          kind: string
          language: string
          origin: string
          payload: Json
          promoted_at: string | null
          rationale: string | null
          shadow_metrics: Json | null
          status: string
          target_key: string | null
          trust_score: number | null
          version: number
        }
        Insert: {
          created_at?: string
          decided_by: string
          evidence?: Json | null
          id: string
          kind: string
          language?: string
          origin: string
          payload: Json
          promoted_at?: string | null
          rationale?: string | null
          shadow_metrics?: Json | null
          status?: string
          target_key?: string | null
          trust_score?: number | null
          version?: number
        }
        Update: {
          created_at?: string
          decided_by?: string
          evidence?: Json | null
          id?: string
          kind?: string
          language?: string
          origin?: string
          payload?: Json
          promoted_at?: string | null
          rationale?: string | null
          shadow_metrics?: Json | null
          status?: string
          target_key?: string | null
          trust_score?: number | null
          version?: number
        }
        Relationships: []
      }
      dynamic_rules_version: {
        Row: {
          note: string | null
          updated_at: string
          version: number
        }
        Insert: {
          note?: string | null
          updated_at?: string
          version: number
        }
        Update: {
          note?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      eval_corpus: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          fixture: Json
          id: string
          kind: string
          observed_at: string
          origin: string
          source_report: string | null
          status: string
          supersedes: number | null
          version: number
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          fixture: Json
          id: string
          kind: string
          observed_at: string
          origin: string
          source_report?: string | null
          status?: string
          supersedes?: number | null
          version: number
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          fixture?: Json
          id?: string
          kind?: string
          observed_at?: string
          origin?: string
          source_report?: string | null
          status?: string
          supersedes?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "eval_corpus_source_report_fkey"
            columns: ["source_report"]
            isOneToOne: false
            referencedRelation: "eval_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_corpus_version: {
        Row: {
          created_at: string
          note: string | null
          version: number
        }
        Insert: {
          created_at: string
          note?: string | null
          version: number
        }
        Update: {
          created_at?: string
          note?: string | null
          version?: number
        }
        Relationships: []
      }
      eval_lock: {
        Row: {
          held_until: string
          name: string
        }
        Insert: {
          held_until: string
          name: string
        }
        Update: {
          held_until?: string
          name?: string
        }
        Relationships: []
      }
      eval_reports: {
        Row: {
          corpus_version: number
          generated_at: string
          id: string
          report: Json
          sample_size: number
          seed: number
        }
        Insert: {
          corpus_version: number
          generated_at: string
          id: string
          report: Json
          sample_size: number
          seed: number
        }
        Update: {
          corpus_version?: number
          generated_at?: string
          id?: string
          report?: Json
          sample_size?: number
          seed?: number
        }
        Relationships: []
      }
      lexicon_overrides: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          payload: Json
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id: string
          kind: string
          payload: Json
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          payload?: Json
          status?: string
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
          rev: number
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
          rev?: number
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
          rev?: number
          source?: string
          source_url?: string | null
        }
        Relationships: []
      }
      rule_decisions: {
        Row: {
          actor: string
          category: string
          decided_at: string
          decision: string
          id: string
          note: string | null
          origin: string
          rule_id: string
        }
        Insert: {
          actor: string
          category: string
          decided_at?: string
          decision: string
          id?: string
          note?: string | null
          origin: string
          rule_id: string
        }
        Update: {
          actor?: string
          category?: string
          decided_at?: string
          decision?: string
          id?: string
          note?: string | null
          origin?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_decisions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "dynamic_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_evaluations: {
        Row: {
          broken_fixtures: Json | null
          corpus_size: number
          evaluated_at: string
          f1_delta: number | null
          id: string
          mode: string | null
          passed: boolean
          regressions: number
          report: Json | null
          rule_id: string | null
          rules_version: number | null
        }
        Insert: {
          broken_fixtures?: Json | null
          corpus_size: number
          evaluated_at?: string
          f1_delta?: number | null
          id?: string
          mode?: string | null
          passed: boolean
          regressions: number
          report?: Json | null
          rule_id?: string | null
          rules_version?: number | null
        }
        Update: {
          broken_fixtures?: Json | null
          corpus_size?: number
          evaluated_at?: string
          f1_delta?: number | null
          id?: string
          mode?: string | null
          passed?: boolean
          regressions?: number
          report?: Json | null
          rule_id?: string | null
          rules_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rule_evaluations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "dynamic_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      source_fetch_log: {
        Row: {
          at: string
          duplicates: number
          error: string | null
          fetched: number
          id: number
          ok: boolean
          relevant: number
          source_id: string
        }
        Insert: {
          at?: string
          duplicates?: number
          error?: string | null
          fetched?: number
          id?: number
          ok: boolean
          relevant?: number
          source_id: string
        }
        Update: {
          at?: string
          duplicates?: number
          error?: string | null
          fetched?: number
          id?: number
          ok?: boolean
          relevant?: number
          source_id?: string
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
          rev: number
        }
        Insert: {
          data: Json
          handle: string
          id: string
          platform: string
          position?: number
          rev?: number
        }
        Update: {
          data?: Json
          handle?: string
          id?: string
          platform?: string
          position?: number
          rev?: number
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
      task_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: number
          started_at: string
          status: string
          summary: string | null
          task: string
          trigger: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          started_at?: string
          status?: string
          summary?: string | null
          task: string
          trigger?: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          started_at?: string
          status?: string
          summary?: string | null
          task?: string
          trigger?: string
        }
        Relationships: []
      }
      taxonomies: {
        Row: {
          canonical_id: string
          data: Json
          id: string
          label: string
          parent_id: string | null
          rev: number
          taxonomy: string
          updated_at: string
        }
        Insert: {
          canonical_id: string
          data: Json
          id: string
          label: string
          parent_id?: string | null
          rev?: number
          taxonomy: string
          updated_at?: string
        }
        Update: {
          canonical_id?: string
          data?: Json
          id?: string
          label?: string
          parent_id?: string | null
          rev?: number
          taxonomy?: string
          updated_at?: string
        }
        Relationships: []
      }
      taxonomy_candidates: {
        Row: {
          data: Json
          first_seen: string
          id: string
          last_seen: string
          occurrences: number
          raw_term: string
          rev: number
          status: string
          taxonomy: string
        }
        Insert: {
          data: Json
          first_seen?: string
          id: string
          last_seen?: string
          occurrences?: number
          raw_term: string
          rev?: number
          status?: string
          taxonomy: string
        }
        Update: {
          data?: Json
          first_seen?: string
          id?: string
          last_seen?: string
          occurrences?: number
          raw_term?: string
          rev?: number
          status?: string
          taxonomy?: string
        }
        Relationships: []
      }
      verification_audit: {
        Row: {
          answer: string | null
          answered_at: string | null
          batch_id: string
          claim_id: string
          control_disputed_at: string | null
          control_kind: string | null
          draw_seed: number
          drawn_at: string
          drone_id: string
          drone_name: string
          evidence: string | null
          family: string
          id: string
          in_seed: boolean
          language: string
          obviously_wrong: boolean
          position: number
          post_text: string | null
          read_via: string | null
          role: string
          second_look: string | null
          source: string
          source_id: string | null
          spec_key: string
          spec_label: string
          state_at_draw: string
          value: string
          verifier_version: string | null
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          batch_id: string
          claim_id: string
          control_disputed_at?: string | null
          control_kind?: string | null
          draw_seed: number
          drawn_at?: string
          drone_id: string
          drone_name: string
          evidence?: string | null
          family: string
          id?: string
          in_seed?: boolean
          language: string
          obviously_wrong?: boolean
          position: number
          post_text?: string | null
          read_via?: string | null
          role: string
          second_look?: string | null
          source: string
          source_id?: string | null
          spec_key: string
          spec_label: string
          state_at_draw: string
          value: string
          verifier_version?: string | null
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          batch_id?: string
          claim_id?: string
          control_disputed_at?: string | null
          control_kind?: string | null
          draw_seed?: number
          drawn_at?: string
          drone_id?: string
          drone_name?: string
          evidence?: string | null
          family?: string
          id?: string
          in_seed?: boolean
          language?: string
          obviously_wrong?: boolean
          position?: number
          post_text?: string | null
          read_via?: string | null
          role?: string
          second_look?: string | null
          source?: string
          source_id?: string | null
          spec_key?: string
          spec_label?: string
          state_at_draw?: string
          value?: string
          verifier_version?: string | null
        }
        Relationships: []
      }
      verifier_controls: {
        Row: {
          altered_value: string
          asked_at: string
          claim_id: string
          drone_id: string
          entailment_version: string
          family: string | null
          id: string
          language: string | null
          model: string | null
          provider: string | null
          source_id: string
          span: string | null
          spec_key: string
          true_value: string
          verdict: string
        }
        Insert: {
          altered_value: string
          asked_at?: string
          claim_id: string
          drone_id: string
          entailment_version: string
          family?: string | null
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          source_id: string
          span?: string | null
          spec_key: string
          true_value: string
          verdict: string
        }
        Update: {
          altered_value?: string
          asked_at?: string
          claim_id?: string
          drone_id?: string
          entailment_version?: string
          family?: string | null
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          source_id?: string
          span?: string | null
          spec_key?: string
          true_value?: string
          verdict?: string
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
