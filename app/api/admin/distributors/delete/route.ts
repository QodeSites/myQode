import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    if (!data.id && !data.email) {
      return NextResponse.json({ success: false, error: 'Distributor ID or Email is required for deletion' }, { status: 400 });
    }

    // Usually we only allow deleting distributors (based on clienttype) just to be safe
    const text = `
      DELETE FROM public.pms_clients_master
      WHERE (id = $1 OR email = $2) AND clienttype = 'DISTRIBUTORS'
      RETURNING id;
    `;
    
    // We pass ID as string/number or null depending on what is sent
    const values = [data.id || null, data.email || null];
    
    const result = await query(text, values);
    
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'Distributor not found or could not be deleted' }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Distributor deleted successfully'
    });

  } catch (error: any) {
    console.error('Error deleting distributor:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete distributor', details: error.message },
      { status: 500 }
    );
  }
}
