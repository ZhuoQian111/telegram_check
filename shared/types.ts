export interface Account { id: string; label: string; username: string; status: string; created_at: string }
export interface Chat { id: string; title: string; username: string; kind: string; peer: string }
export interface Task { id: string; name: string; account_id: string; chat_id: string; chat_title: string; peer: string; text: string; time: string; timezone: string; enabled: number; next_run: string; created_at: string }
export interface Run { id: string; task_id: string | null; task_name: string; account_id: string; chat_title: string; scheduled_at: string; started_at: string | null; finished_at: string | null; status: string; error: string | null; message_id: string | null; random_id: string; kind: string }
