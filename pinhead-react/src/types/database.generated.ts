/**
 * Типы схемы Supabase — СГЕНЕРИРОВАНЫ ИЗ БАЗЫ, править руками нельзя.
 *
 * Зачем. `erp/types.ts` описывает те же таблицы вручную, и расхождение с базой
 * ловилось только косвенно — тестом `orderSelect.test.ts`, который вытаскивает
 * обращения `stage.X` из кода. То есть про колонку, которую переименовали
 * в миграции, приложение узнавало в рантайме.
 *
 * Здесь — машинная копия схемы. Ручные типы остаются: они описывают ДОМЕН
 * (ErpOrderFull со вложенными позициями, статусы как union), а не таблицы,
 * и заменять их генерацией нельзя — вложенных деревьев в схеме нет.
 * Задача файла другая: дать `schema.test.ts` возможность сверить их с базой.
 *
 * Обновление: `npm run types:db` (нужен SUPABASE_ACCESS_TOKEN) или
 * MCP-инструмент Supabase `generate_typescript_types`.
 */

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          key: string
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      catalog_config: {
        Row: {
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      erp_bypasses: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_id: string | null
          id: string
          kind: string
          order_id: string | null
          reason: string
          restored_at: string | null
          restored_by: string | null
          restored_by_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_id?: string | null
          id?: string
          kind: string
          order_id?: string | null
          reason: string
          restored_at?: string | null
          restored_by?: string | null
          restored_by_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_id?: string | null
          id?: string
          kind?: string
          order_id?: string | null
          reason?: string
          restored_at?: string | null
          restored_by?: string | null
          restored_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_bypasses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_calendar_slots: {
        Row: {
          assignee: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          department_id: string
          deviation_reason: string | null
          fact_at: string | null
          fact_by: string | null
          fact_comment: string | null
          id: string
          priority: number
          problem_affects_due: boolean
          problem_can_continue: boolean
          problem_needs_help: boolean
          problem_note: string | null
          problem_type: string | null
          qty_defect: number
          qty_done: number | null
          qty_planned: number
          sort_order: number
          stage_id: string | null
          status: string
          updated_at: string
          work_date: string
        }
        Insert: {
          assignee?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          deviation_reason?: string | null
          fact_at?: string | null
          fact_by?: string | null
          fact_comment?: string | null
          id?: string
          priority?: number
          problem_affects_due?: boolean
          problem_can_continue?: boolean
          problem_needs_help?: boolean
          problem_note?: string | null
          problem_type?: string | null
          qty_defect?: number
          qty_done?: number | null
          qty_planned?: number
          sort_order?: number
          stage_id?: string | null
          status?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          assignee?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          deviation_reason?: string | null
          fact_at?: string | null
          fact_by?: string | null
          fact_comment?: string | null
          id?: string
          priority?: number
          problem_affects_due?: boolean
          problem_can_continue?: boolean
          problem_needs_help?: boolean
          problem_note?: string | null
          problem_type?: string | null
          qty_defect?: number
          qty_done?: number | null
          qty_planned?: number
          sort_order?: number
          stage_id?: string | null
          status?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_calendar_slots_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "erp_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_calendar_slots_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_departments: {
        Row: {
          active: boolean
          code: string
          created_at: string
          gate_material_kinds: string[]
          head_employee_id: string | null
          id: string
          is_branding: boolean
          is_production: boolean
          name: string
          norm_days: number | null
          result_fields: Json
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          gate_material_kinds?: string[]
          head_employee_id?: string | null
          id?: string
          is_branding?: boolean
          is_production?: boolean
          name: string
          norm_days?: number | null
          result_fields?: Json
          sort_order?: number
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          gate_material_kinds?: string[]
          head_employee_id?: string | null
          id?: string
          is_branding?: boolean
          is_production?: boolean
          name?: string
          norm_days?: number | null
          result_fields?: Json
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_departments_head_employee_id_fkey"
            columns: ["head_employee_id"]
            isOneToOne: false
            referencedRelation: "erp_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_dictionaries: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          kind: string
          meta: Json
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          kind: string
          meta?: Json
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          kind?: string
          meta?: Json
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      erp_employees: {
        Row: {
          active: boolean
          created_at: string
          department_id: string | null
          extra_department_ids: string[]
          full_name: string
          id: string
          notes: string | null
          profile_id: string | null
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          extra_department_ids?: string[]
          full_name: string
          id?: string
          notes?: string | null
          profile_id?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          extra_department_ids?: string[]
          full_name?: string
          id?: string
          notes?: string | null
          profile_id?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "erp_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_experimental: {
        Row: {
          closed_at: string | null
          comment: string | null
          constructor: string | null
          created_at: string
          dev_type: string | null
          due_date: string | null
          has_3d: boolean
          id: string
          item_id: string | null
          measurement_table: string | null
          order_id: string
          outcome: string | null
          outcome_comment: string | null
          owner: string | null
          priority: number
          tech_name: string | null
          technologist: string | null
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          comment?: string | null
          constructor?: string | null
          created_at?: string
          dev_type?: string | null
          due_date?: string | null
          has_3d?: boolean
          id?: string
          item_id?: string | null
          measurement_table?: string | null
          order_id: string
          outcome?: string | null
          outcome_comment?: string | null
          owner?: string | null
          priority?: number
          tech_name?: string | null
          technologist?: string | null
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          comment?: string | null
          constructor?: string | null
          created_at?: string
          dev_type?: string | null
          due_date?: string | null
          has_3d?: boolean
          id?: string
          item_id?: string | null
          measurement_table?: string | null
          order_id?: string
          outcome?: string | null
          outcome_comment?: string | null
          owner?: string | null
          priority?: number
          tech_name?: string | null
          technologist?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_experimental_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_experimental_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_experimental_tasks: {
        Row: {
          blocked_reason: string | null
          comment: string | null
          created_at: string
          cycle: number
          department_id: string | null
          depends_on: string[]
          done_on: string | null
          due_date: string | null
          experimental_id: string
          id: string
          qty: number | null
          responsible: string | null
          result: string | null
          sort_order: number
          stage_id: string | null
          status: string
          task_type: string
          title: string | null
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          comment?: string | null
          created_at?: string
          cycle?: number
          department_id?: string | null
          depends_on?: string[]
          done_on?: string | null
          due_date?: string | null
          experimental_id: string
          id?: string
          qty?: number | null
          responsible?: string | null
          result?: string | null
          sort_order?: number
          stage_id?: string | null
          status?: string
          task_type: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          comment?: string | null
          created_at?: string
          cycle?: number
          department_id?: string | null
          depends_on?: string[]
          done_on?: string | null
          due_date?: string | null
          experimental_id?: string
          id?: string
          qty?: number | null
          responsible?: string | null
          result?: string | null
          sort_order?: number
          stage_id?: string | null
          status?: string
          task_type?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_experimental_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "erp_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_experimental_tasks_experimental_id_fkey"
            columns: ["experimental_id"]
            isOneToOne: false
            referencedRelation: "erp_experimental"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_experimental_tasks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          department_id: string | null
          email: string | null
          employee_role: string
          expires_at: string
          note: string | null
          profile_role: string
          revoked_at: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          email?: string | null
          employee_role: string
          expires_at: string
          note?: string | null
          profile_role: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          email?: string | null
          employee_role?: string
          expires_at?: string
          note?: string | null
          profile_role?: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_invites_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "erp_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_item_prints: {
        Row: {
          comment: string | null
          created_at: string
          fabric: string | null
          height_mm: number | null
          id: string
          item_id: string
          method: string
          offset_note: string | null
          pantone: string | null
          seq: number
          special: string | null
          width_mm: number | null
          zone: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          fabric?: string | null
          height_mm?: number | null
          id?: string
          item_id: string
          method: string
          offset_note?: string | null
          pantone?: string | null
          seq?: number
          special?: string | null
          width_mm?: number | null
          zone?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          fabric?: string | null
          height_mm?: number | null
          id?: string
          item_id?: string
          method?: string
          offset_note?: string | null
          pantone?: string | null
          seq?: number
          special?: string | null
          width_mm?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_item_prints_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_item_stages: {
        Row: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          block_reason?: string | null
          contractor?: string | null
          created_at?: string
          cycle?: number
          department_id: string
          depends_on?: string[]
          executor?: string
          finished_at?: string | null
          id?: string
          item_id: string
          notes?: string | null
          operation?: string | null
          origin?: string
          overdue_ack_at?: string | null
          overdue_comment?: string | null
          planned_end?: string | null
          planned_start?: string | null
          qty_done?: number
          qty_rework?: number
          queue_position?: number | null
          sort_order?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          block_reason?: string | null
          contractor?: string | null
          created_at?: string
          cycle?: number
          department_id?: string
          depends_on?: string[]
          executor?: string
          finished_at?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          operation?: string | null
          origin?: string
          overdue_ack_at?: string | null
          overdue_comment?: string | null
          planned_end?: string | null
          planned_start?: string | null
          qty_done?: number
          qty_rework?: number
          queue_position?: number | null
          sort_order?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_item_stages_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "erp_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_item_stages_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_material_receipts: {
        Row: {
          accept_status: string
          author: string | null
          author_id: string | null
          comment: string | null
          created_at: string
          id: string
          invoice: string | null
          material_id: string
          qty: number
          received_on: string
          unit: string | null
        }
        Insert: {
          accept_status?: string
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          invoice?: string | null
          material_id: string
          qty: number
          received_on?: string
          unit?: string | null
        }
        Update: {
          accept_status?: string
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          invoice?: string | null
          material_id?: string
          qty?: number
          received_on?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_material_receipts_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "erp_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_material_suppliers: {
        Row: {
          availability: string | null
          created_at: string
          id: string
          is_selected: boolean
          lead_days: number | null
          material_id: string
          min_batch: string | null
          note: string | null
          price: number | null
          supplier: string
          updated_at: string
        }
        Insert: {
          availability?: string | null
          created_at?: string
          id?: string
          is_selected?: boolean
          lead_days?: number | null
          material_id: string
          min_batch?: string | null
          note?: string | null
          price?: number | null
          supplier: string
          updated_at?: string
        }
        Update: {
          availability?: string | null
          created_at?: string
          id?: string
          is_selected?: boolean
          lead_days?: number | null
          material_id?: string
          min_batch?: string | null
          note?: string | null
          price?: number | null
          supplier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_material_suppliers_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "erp_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_materials: {
        Row: {
          accept_comment: string | null
          accept_status: string | null
          accepted_at: string | null
          accepted_by: string | null
          article: string | null
          color: string | null
          created_at: string
          eta_date: string | null
          fact_article: string | null
          fact_color: string | null
          fact_name: string | null
          id: string
          item_id: string | null
          kind: string
          manager_note: string | null
          name: string
          notes: string | null
          order_id: string | null
          ordered_on: string | null
          price_per_unit: number | null
          qty: string | null
          qty_expected: number | null
          qty_ordered: number | null
          qty_received: number | null
          received_at: string | null
          responsible: string | null
          role: string | null
          source: string
          status: string
          supplier: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          accept_comment?: string | null
          accept_status?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          article?: string | null
          color?: string | null
          created_at?: string
          eta_date?: string | null
          fact_article?: string | null
          fact_color?: string | null
          fact_name?: string | null
          id?: string
          item_id?: string | null
          kind: string
          manager_note?: string | null
          name: string
          notes?: string | null
          order_id?: string | null
          ordered_on?: string | null
          price_per_unit?: number | null
          qty?: string | null
          qty_expected?: number | null
          qty_ordered?: number | null
          qty_received?: number | null
          received_at?: string | null
          responsible?: string | null
          role?: string | null
          source?: string
          status?: string
          supplier?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          accept_comment?: string | null
          accept_status?: string | null
          accepted_at?: string | null
          accepted_by?: string | null
          article?: string | null
          color?: string | null
          created_at?: string
          eta_date?: string | null
          fact_article?: string | null
          fact_color?: string | null
          fact_name?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          manager_note?: string | null
          name?: string
          notes?: string | null
          order_id?: string | null
          ordered_on?: string | null
          price_per_unit?: number | null
          qty?: string | null
          qty_expected?: number | null
          qty_ordered?: number | null
          qty_received?: number | null
          received_at?: string | null
          responsible?: string | null
          role?: string | null
          source?: string
          status?: string
          supplier?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_materials_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_materials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_order_attachments: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          id: string
          item_id: string | null
          kind: string
          material_id: string | null
          order_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          id?: string
          item_id?: string | null
          kind?: string
          material_id?: string | null
          order_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          id?: string
          item_id?: string | null
          kind?: string
          material_id?: string | null
          order_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_order_attachments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_order_attachments_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "erp_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_order_attachments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_order_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_id: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          order_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_id?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_id?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_order_audit_changed_by_id_fkey"
            columns: ["changed_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_order_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_order_comments: {
        Row: {
          author: string
          created_at: string
          id: string
          order_id: string
          text: string
        }
        Insert: {
          author: string
          created_at?: string
          id?: string
          order_id: string
          text: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          order_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_order_comments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_order_items: {
        Row: {
          branding_methods: string[]
          branding_on: string | null
          created_at: string
          cutting_note: string | null
          fit: string | null
          id: string
          labels_note: string | null
          marking_place: string | null
          material_source: string | null
          notes: string | null
          order_id: string
          packaging: string
          packaging_note: string | null
          packaging_size: string | null
          product_type: string
          production_type: string
          qty: number
          sewing_note: string | null
          size_grid: Json | null
          sort_order: number
          sticker_place: string | null
          subcontract_kind: string | null
          trim_material: string | null
          updated_at: string
          variant: string | null
        }
        Insert: {
          branding_methods?: string[]
          branding_on?: string | null
          created_at?: string
          cutting_note?: string | null
          fit?: string | null
          id?: string
          labels_note?: string | null
          marking_place?: string | null
          material_source?: string | null
          notes?: string | null
          order_id: string
          packaging?: string
          packaging_note?: string | null
          packaging_size?: string | null
          product_type: string
          production_type?: string
          qty: number
          sewing_note?: string | null
          size_grid?: Json | null
          sort_order?: number
          sticker_place?: string | null
          subcontract_kind?: string | null
          trim_material?: string | null
          updated_at?: string
          variant?: string | null
        }
        Update: {
          branding_methods?: string[]
          branding_on?: string | null
          created_at?: string
          cutting_note?: string | null
          fit?: string | null
          id?: string
          labels_note?: string | null
          marking_place?: string | null
          material_source?: string | null
          notes?: string | null
          order_id?: string
          packaging?: string
          packaging_note?: string | null
          packaging_size?: string | null
          product_type?: string
          production_type?: string
          qty?: number
          sewing_note?: string | null
          size_grid?: Json | null
          sort_order?: number
          sticker_place?: string | null
          subcontract_kind?: string | null
          trim_material?: string | null
          updated_at?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_orders: {
        Row: {
          bitrix_id: string | null
          buffer_days: number
          created_at: string
          created_by: string | null
          customer: string | null
          delivered_at: string | null
          due_date: string | null
          id: string
          is_demo: boolean
          launch_date: string | null
          manager: string | null
          no_chestny_znak: boolean
          notes: string | null
          packaging: string
          packaging_note: string | null
          priority: number
          shipped_at: string | null
          shipped_by: string | null
          shipped_status: string
          status: string
          stickers: string
          stickers_note: string | null
          title: string
          tz_number: string | null
          tz_order_id: string | null
          tz_required: boolean
          updated_at: string
        }
        Insert: {
          bitrix_id?: string | null
          buffer_days?: number
          created_at?: string
          created_by?: string | null
          customer?: string | null
          delivered_at?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          launch_date?: string | null
          manager?: string | null
          no_chestny_znak?: boolean
          notes?: string | null
          packaging?: string
          packaging_note?: string | null
          priority?: number
          shipped_at?: string | null
          shipped_by?: string | null
          shipped_status?: string
          status?: string
          stickers?: string
          stickers_note?: string | null
          title: string
          tz_number?: string | null
          tz_order_id?: string | null
          tz_required?: boolean
          updated_at?: string
        }
        Update: {
          bitrix_id?: string | null
          buffer_days?: number
          created_at?: string
          created_by?: string | null
          customer?: string | null
          delivered_at?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          launch_date?: string | null
          manager?: string | null
          no_chestny_znak?: boolean
          notes?: string | null
          packaging?: string
          packaging_note?: string | null
          priority?: number
          shipped_at?: string | null
          shipped_by?: string | null
          shipped_status?: string
          status?: string
          stickers?: string
          stickers_note?: string | null
          title?: string
          tz_number?: string | null
          tz_order_id?: string | null
          tz_required?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_orders_tz_order_id_fkey"
            columns: ["tz_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_plan_comments: {
        Row: {
          author: string
          created_at: string
          id: string
          side: string
          slot_id: string
          text: string
        }
        Insert: {
          author: string
          created_at?: string
          id?: string
          side: string
          slot_id: string
          text: string
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          side?: string
          slot_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_plan_comments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "erp_calendar_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_procurement_tasks: {
        Row: {
          cause_type: string
          counts_as_purchase: boolean
          created_at: string
          id: string
          initiating_dept: string | null
          item_id: string | null
          kind: string
          material_name: string
          order_id: string
          planned_date: string | null
          reason: string | null
          required_qty: string | null
          responsible: string | null
          rework_qty: number | null
          source_stage_id: string | null
          status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          cause_type?: string
          counts_as_purchase?: boolean
          created_at?: string
          id?: string
          initiating_dept?: string | null
          item_id?: string | null
          kind?: string
          material_name: string
          order_id: string
          planned_date?: string | null
          reason?: string | null
          required_qty?: string | null
          responsible?: string | null
          rework_qty?: number | null
          source_stage_id?: string | null
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          cause_type?: string
          counts_as_purchase?: boolean
          created_at?: string
          id?: string
          initiating_dept?: string | null
          item_id?: string | null
          kind?: string
          material_name?: string
          order_id?: string
          planned_date?: string | null
          reason?: string | null
          required_qty?: string | null
          responsible?: string | null
          rework_qty?: number | null
          source_stage_id?: string | null
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_procurement_tasks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_procurement_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_procurement_tasks_source_stage_id_fkey"
            columns: ["source_stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_role_permissions: {
        Row: {
          allowed: boolean
          permission: string
          role: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          permission: string
          role: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          permission?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      erp_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          updated_by_id: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          updated_by_id?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_id?: string | null
          value?: Json
        }
        Relationships: []
      }
      erp_stage_events: {
        Row: {
          actor: string | null
          actor_id: string | null
          comment: string | null
          created_at: string
          from_status: string | null
          id: string
          order_id: string
          qty_done: number | null
          qty_rework: number | null
          stage_id: string
          to_status: string
        }
        Insert: {
          actor?: string | null
          actor_id?: string | null
          comment?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          order_id: string
          qty_done?: number | null
          qty_rework?: number | null
          stage_id: string
          to_status: string
        }
        Update: {
          actor?: string | null
          actor_id?: string | null
          comment?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          order_id?: string
          qty_done?: number | null
          qty_rework?: number | null
          stage_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_stage_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_stage_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_stage_events_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_stage_reports: {
        Row: {
          author: string | null
          author_id: string | null
          comment: string | null
          created_at: string
          extra: Json
          id: string
          qty_defect: number
          qty_extra: number
          qty_good: number
          qty_in: number | null
          qty_rework: number
          stage_id: string | null
          warehouse_task_id: string | null
        }
        Insert: {
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          extra?: Json
          id?: string
          qty_defect?: number
          qty_extra?: number
          qty_good?: number
          qty_in?: number | null
          qty_rework?: number
          stage_id?: string | null
          warehouse_task_id?: string | null
        }
        Update: {
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          extra?: Json
          id?: string
          qty_defect?: number
          qty_extra?: number
          qty_good?: number
          qty_in?: number | null
          qty_rework?: number
          stage_id?: string | null
          warehouse_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_stage_reports_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_stage_reports_warehouse_task_id_fkey"
            columns: ["warehouse_task_id"]
            isOneToOne: false
            referencedRelation: "erp_warehouse_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_subcontract_moves: {
        Row: {
          author: string | null
          author_id: string | null
          comment: string | null
          created_at: string
          id: string
          kind: string
          moved_on: string
          qty: number
          subcontract_id: string
        }
        Insert: {
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          kind: string
          moved_on?: string
          qty: number
          subcontract_id: string
        }
        Update: {
          author?: string | null
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          kind?: string
          moved_on?: string
          qty?: number
          subcontract_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_subcontract_moves_subcontract_id_fkey"
            columns: ["subcontract_id"]
            isOneToOne: false
            referencedRelation: "erp_subcontracting"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_subcontracting: {
        Row: {
          comment: string | null
          contractor: string | null
          cost: number | null
          created_at: string
          delay_comment: string | null
          id: string
          item_id: string | null
          material_source: string
          materials_note: string | null
          materials_qty: string | null
          materials_sent_on: string | null
          op_type: string
          operation: string
          order_id: string
          paid_amount: number | null
          payment_status: string
          phase: string
          planned_date: string | null
          qty: number | null
          qty_accepted: number
          qty_returned: number
          qty_sent: number
          responsible: string | null
          return_dept: string | null
          returned_date: string | null
          send_plan_date: string | null
          sent_date: string | null
          stage_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          contractor?: string | null
          cost?: number | null
          created_at?: string
          delay_comment?: string | null
          id?: string
          item_id?: string | null
          material_source?: string
          materials_note?: string | null
          materials_qty?: string | null
          materials_sent_on?: string | null
          op_type?: string
          operation: string
          order_id: string
          paid_amount?: number | null
          payment_status?: string
          phase?: string
          planned_date?: string | null
          qty?: number | null
          qty_accepted?: number
          qty_returned?: number
          qty_sent?: number
          responsible?: string | null
          return_dept?: string | null
          returned_date?: string | null
          send_plan_date?: string | null
          sent_date?: string | null
          stage_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          contractor?: string | null
          cost?: number | null
          created_at?: string
          delay_comment?: string | null
          id?: string
          item_id?: string | null
          material_source?: string
          materials_note?: string | null
          materials_qty?: string | null
          materials_sent_on?: string | null
          op_type?: string
          operation?: string
          order_id?: string
          paid_amount?: number | null
          payment_status?: string
          phase?: string
          planned_date?: string | null
          qty?: number | null
          qty_accepted?: number
          qty_returned?: number
          qty_sent?: number
          responsible?: string | null
          return_dept?: string | null
          returned_date?: string | null
          send_plan_date?: string | null
          sent_date?: string | null
          stage_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_subcontracting_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_subcontracting_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_subcontracting_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_tz_documents: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          group_id: string
          id: string
          is_current: boolean
          item_id: string | null
          mime_type: string | null
          note: string | null
          order_id: string
          size_bytes: number | null
          stage_id: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          group_id: string
          id?: string
          is_current?: boolean
          item_id?: string | null
          mime_type?: string | null
          note?: string | null
          order_id: string
          size_bytes?: number | null
          stage_id?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          group_id?: string
          id?: string
          is_current?: boolean
          item_id?: string | null
          mime_type?: string | null
          note?: string | null
          order_id?: string
          size_bytes?: number | null
          stage_id?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "erp_tz_documents_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_tz_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_tz_documents_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "erp_item_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_warehouse_ops: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          material_id: string | null
          note: string | null
          op_type: string
          order_id: string
          qty: number | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          material_id?: string | null
          note?: string | null
          op_type: string
          order_id: string
          qty?: number | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          material_id?: string | null
          note?: string | null
          op_type?: string
          order_id?: string
          qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_warehouse_ops_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "erp_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_warehouse_ops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_warehouse_tasks: {
        Row: {
          created_at: string
          deadline: string | null
          id: string
          item_id: string | null
          marking_type: string | null
          note: string | null
          order_id: string
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          id?: string
          item_id?: string | null
          marking_type?: string | null
          note?: string | null
          order_id: string
          status: string
          task_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          id?: string
          item_id?: string | null
          marking_type?: string | null
          note?: string | null
          order_id?: string
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_warehouse_tasks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "erp_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_warehouse_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_audit: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          order_id: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_comments: {
        Row: {
          author_name: string
          author_role: string
          created_at: string | null
          id: string
          order_id: string | null
          text: string
        }
        Insert: {
          author_name: string
          author_role: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          text: string
        }
        Update: {
          author_name?: string
          author_role?: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_comments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          data: Json
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          data: Json
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          artwork_link: string | null
          bitrix_deal: string | null
          created_at: string | null
          created_by: string | null
          data: Json
          erp_order_id: string | null
          id: string
          item_type: string | null
          notes: string | null
          order_number: string | null
          status: string
          total_qty: number | null
          total_sum: number | null
          updated_at: string | null
        }
        Insert: {
          artwork_link?: string | null
          bitrix_deal?: string | null
          created_at?: string | null
          created_by?: string | null
          data?: Json
          erp_order_id?: string | null
          id?: string
          item_type?: string | null
          notes?: string | null
          order_number?: string | null
          status?: string
          total_qty?: number | null
          total_sum?: number | null
          updated_at?: string | null
        }
        Update: {
          artwork_link?: string | null
          bitrix_deal?: string | null
          created_at?: string | null
          created_by?: string | null
          data?: Json
          erp_order_id?: string | null
          id?: string
          item_type?: string | null
          notes?: string | null
          order_number?: string | null
          status?: string
          total_qty?: number | null
          total_sum?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_erp_order_id_fkey"
            columns: ["erp_order_id"]
            isOneToOne: false
            referencedRelation: "erp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          approved: boolean | null
          assigned_section_id: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          role: string
          sub_role: string | null
        }
        Insert: {
          active?: boolean
          approved?: boolean | null
          assigned_section_id?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          name?: string
          role?: string
          sub_role?: string | null
        }
        Update: {
          active?: boolean
          approved?: boolean | null
          assigned_section_id?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          role?: string
          sub_role?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      erp_bootstrap: { Args: never; Returns: Json }
      erp_can_act_in_dept: { Args: { p_dept: string }; Returns: boolean }
      erp_can_pack_ship: { Args: { p_order_id: string }; Returns: boolean }
      erp_clamp_done: {
        Args: { p_current: number; p_delta: number; p_total: number }
        Returns: number
      }
      erp_clamp_rework: {
        Args: { p_current: number; p_delta: number }
        Returns: number
      }
      erp_create_order: { Args: { payload: Json }; Returns: string }
      erp_default_queue_position: { Args: { p_due: string }; Returns: number }
      erp_experimental_add_tasks: {
        Args: { p_experimental_id: string; p_tasks: Json }
        Returns: {
          blocked_reason: string | null
          comment: string | null
          created_at: string
          cycle: number
          department_id: string | null
          depends_on: string[]
          done_on: string | null
          due_date: string | null
          experimental_id: string
          id: string
          qty: number | null
          responsible: string | null
          result: string | null
          sort_order: number
          stage_id: string | null
          status: string
          task_type: string
          title: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "erp_experimental_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      erp_experimental_task_send: {
        Args: {
          p_department_id: string
          p_planned_end?: string
          p_qty?: number
          p_task_id: string
        }
        Returns: {
          blocked_reason: string | null
          comment: string | null
          created_at: string
          cycle: number
          department_id: string | null
          depends_on: string[]
          done_on: string | null
          due_date: string | null
          experimental_id: string
          id: string
          qty: number | null
          responsible: string | null
          result: string | null
          sort_order: number
          stage_id: string | null
          status: string
          task_type: string
          title: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "erp_experimental_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      erp_has_permission: { Args: { perm: string }; Returns: boolean }
      erp_invite_preview: {
        Args: { p_code: string }
        Returns: {
          department_name: string
          email: string
          employee_role: string
          expires_at: string
          profile_role: string
        }[]
      }
      erp_is_manager: { Args: never; Returns: boolean }
      erp_is_member: { Args: never; Returns: boolean }
      erp_local_date: { Args: never; Returns: string }
      erp_order_detail: { Args: { p_order_id: string }; Returns: Json }
      erp_role_of_caller: { Args: never; Returns: string }
      erp_route_apply: {
        Args: { p_item_id: string; p_steps: Json }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      erp_stage_apply_defect: {
        Args: { p_patches: Json }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      erp_stage_item_qty: { Args: { p_stage_id: string }; Returns: number }
      erp_stage_move_department: {
        Args: {
          p_queue_position?: number
          p_stage_id: string
          p_target_dept: string
        }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      erp_stage_reorder_queue: {
        Args: { p_writes: Json }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      erp_stage_report_progress: {
        Args: { p_qty: number; p_stage_id: string }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      erp_stage_submit_report: {
        Args: {
          p_comment?: string
          p_extra?: Json
          p_qty_defect?: number
          p_qty_extra?: number
          p_qty_good: number
          p_qty_in: number
          p_qty_rework?: number
          p_stage_id: string
        }
        Returns: {
          assignee: string | null
          block_reason: string | null
          contractor: string | null
          created_at: string
          cycle: number
          department_id: string
          depends_on: string[]
          executor: string
          finished_at: string | null
          id: string
          item_id: string
          notes: string | null
          operation: string | null
          origin: string
          overdue_ack_at: string | null
          overdue_comment: string | null
          planned_end: string | null
          planned_start: string | null
          qty_done: number
          qty_rework: number
          queue_position: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "erp_item_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      erp_warehouse_submit_report: {
        Args: {
          p_comment?: string
          p_extra?: Json
          p_qty_defect?: number
          p_qty_good: number
          p_qty_in: number
          p_task_id: string
        }
        Returns: {
          created_at: string
          deadline: string | null
          id: string
          item_id: string | null
          marking_type: string | null
          note: string | null
          order_id: string
          status: string
          task_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "erp_warehouse_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: never; Returns: boolean }
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
