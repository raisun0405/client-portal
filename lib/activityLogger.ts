import { supabase } from './supabase';

export type ActivityAction =
    | 'project_created'
    | 'project_updated'
    | 'project_completed'
    | 'feature_added'
    | 'feature_updated'
    | 'feature_completed'
    | 'feature_deleted'
    | 'payment_received'
    | 'link_added'
    | 'link_removed'
    | 'status_changed';

export type ActivityLog = {
    id: string;
    client_id: string;
    project_id: string | null;
    action_type: ActivityAction;
    title: string;
    description: string | null;
    metadata: Record<string, any>;
    created_at: string;
};

/**
 * Logs an activity to the activity_logs table in Supabase.
 */
export async function logActivity({
    clientId,
    projectId,
    actionType,
    title,
    description,
    metadata = {},
}: {
    clientId: string;
    projectId?: string | null;
    actionType: ActivityAction;
    title: string;
    description?: string;
    metadata?: Record<string, any>;
}) {
    try {
        const { error } = await supabase.from('activity_logs').insert([
            {
                client_id: clientId,
                project_id: projectId || null,
                action_type: actionType,
                title,
                description: description || null,
                metadata,
            },
        ]);

        if (error) {
            console.error('Failed to log activity:', error.message);
        }
    } catch (err) {
        console.error('Activity logging error:', err);
    }
}

/**
 * Fetches activity logs for a given client.
 */
export async function fetchActivityLogs(clientId: string, limit = 20): Promise<ActivityLog[]> {
    const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Failed to fetch activity logs:', error.message);
        return [];
    }

    return data || [];
}
