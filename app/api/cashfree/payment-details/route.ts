// app/api/cashfree/payment-details/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('order_id')

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      )
    }

    console.log('Fetching payment details for order ID:', orderId)

    // UPDATED: Include is_new_strategy and strategy_type fields
    const result = await query(
      `SELECT id, order_id, client_id, nuvama_code, client_name, amount, currency, 
              payment_type, payment_status, payment_session_id, cf_order_id, 
              cf_subscription_id, account_number, ifsc_code, frequency, start_date, 
              end_date, total_installments, next_charge_date, created_at, updated_at, 
              canceled_at, is_new_strategy, strategy_type
       FROM payment_transactions 
       WHERE order_id = $1 OR cf_order_id = $1 OR cf_subscription_id = $1
       ORDER BY created_at DESC 
       LIMIT 1`,
      [orderId]
    )

    if (result.rows.length > 0) {
      const transaction = result.rows[0]
      
      console.log('Found payment transaction:', {
        id: transaction.id,
        order_id: transaction.order_id,
        payment_type: transaction.payment_type,
        payment_status: transaction.payment_status,
        is_new_strategy: transaction.is_new_strategy,
        strategy_type: transaction.strategy_type
      })
      
      return NextResponse.json({
        success: true,
        payment: {
          id: transaction.id,
          order_id: transaction.order_id,
          cf_order_id: transaction.cf_order_id,
          cf_subscription_id: transaction.cf_subscription_id,
          client_id: transaction.client_id,
          nuvama_code: transaction.nuvama_code,
          client_name: transaction.client_name,
          amount: transaction.amount,
          currency: transaction.currency,
          payment_type: transaction.payment_type,
          payment_status: transaction.payment_status,
          payment_session_id: transaction.payment_session_id,
          account_number: transaction.account_number,
          ifsc_code: transaction.ifsc_code,
          frequency: transaction.frequency,
          start_date: transaction.start_date,
          end_date: transaction.end_date,
          total_installments: transaction.total_installments,
          next_charge_date: transaction.next_charge_date,
          created_at: transaction.created_at,
          updated_at: transaction.updated_at,
          canceled_at: transaction.canceled_at,
          // UPDATED: Use actual database fields instead of hardcoded logic
          is_new_strategy: transaction.is_new_strategy || false,
          strategy_type: transaction.strategy_type,
          requested_strategy: transaction.strategy_type, // For backwards compatibility
          transaction_type: transaction.payment_type || (transaction.frequency ? 'sip' : 'one_time')
        }
      })
    }

    // If no exact match found, try broader search with LIKE patterns
    console.log('No exact match found, trying broader search...')
    
    // UPDATED: Include is_new_strategy and strategy_type in broader search too
    const broadSearchResult = await query(
      `SELECT id, order_id, client_id, nuvama_code, client_name, amount, currency, 
              payment_type, payment_status, payment_session_id, cf_order_id, 
              cf_subscription_id, account_number, ifsc_code, frequency, start_date, 
              end_date, total_installments, next_charge_date, created_at, updated_at, 
              canceled_at, is_new_strategy, strategy_type
       FROM payment_transactions 
       WHERE order_id LIKE $1 OR cf_order_id LIKE $1 OR cf_subscription_id LIKE $1 
             OR $1 LIKE '%' || order_id || '%' OR $1 LIKE '%' || cf_order_id || '%'
       ORDER BY created_at DESC 
       LIMIT 1`,
      [`%${orderId}%`]
    )

    if (broadSearchResult.rows.length > 0) {
      const transaction = broadSearchResult.rows[0]
      
      console.log('Found transaction with broader search:', {
        id: transaction.id,
        order_id: transaction.order_id,
        cf_order_id: transaction.cf_order_id,
        is_new_strategy: transaction.is_new_strategy,
        strategy_type: transaction.strategy_type
      })
      
      return NextResponse.json({
        success: true,
        payment: {
          id: transaction.id,
          order_id: transaction.order_id,
          cf_order_id: transaction.cf_order_id,
          cf_subscription_id: transaction.cf_subscription_id,
          client_id: transaction.client_id,
          nuvama_code: transaction.nuvama_code,
          client_name: transaction.client_name,
          amount: transaction.amount,
          currency: transaction.currency,
          payment_type: transaction.payment_type,
          payment_status: transaction.payment_status,
          payment_session_id: transaction.payment_session_id,
          account_number: transaction.account_number,
          ifsc_code: transaction.ifsc_code,
          frequency: transaction.frequency,
          start_date: transaction.start_date,
          end_date: transaction.end_date,
          total_installments: transaction.total_installments,
          next_charge_date: transaction.next_charge_date,
          created_at: transaction.created_at,
          updated_at: transaction.updated_at,
          canceled_at: transaction.canceled_at,
          // UPDATED: Use actual database fields
          is_new_strategy: transaction.is_new_strategy || false,
          strategy_type: transaction.strategy_type,
          requested_strategy: transaction.strategy_type, // For backwards compatibility
          transaction_type: transaction.payment_type || (transaction.frequency ? 'sip' : 'one_time')
        }
      })
    }

    // Log recent transactions for debugging
    const recentTransactions = await query(
      `SELECT id, order_id, cf_order_id, cf_subscription_id, payment_type, is_new_strategy, strategy_type, created_at 
       FROM payment_transactions 
       ORDER BY created_at DESC 
       LIMIT 10`
    )

    console.log('Recent payment transactions:', recentTransactions.rows)
    console.log('Searched for order_id:', orderId)

    // If still not found, return error with helpful debugging info
    return NextResponse.json(
      { 
        success: false, 
        error: 'Payment details not found',
        searched_order_id: orderId,
        recent_transactions: recentTransactions.rows.map(row => ({
          id: row.id,
          order_id: row.order_id,
          cf_order_id: row.cf_order_id,
          cf_subscription_id: row.cf_subscription_id,
          payment_type: row.payment_type,
          is_new_strategy: row.is_new_strategy,
          strategy_type: row.strategy_type,
          created_at: row.created_at
        }))
      },
      { status: 404 }
    )

  } catch (error) {
    console.error('Error fetching payment details:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}