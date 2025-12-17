import { NextResponse } from 'next/server'
import db from "@/lib/db2";
import dayjs from "dayjs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const indices = searchParams.get('indices');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  try {
    if (!indices) {
      return NextResponse.json({ message: "indices parameter is required" }, { status: 400 });
    }

    // Convert the indices from URL to uppercase so they match the DB.
    const indicesList = indices
      .split(",")
      .map((item: string) => item.trim().toUpperCase());

    // Parse dates if provided; accepts any format that Date() can handle.
    let parsedStartDate: string | null = null;
    let parsedEndDate: string | null = null;
    if (startDate) {
      parsedStartDate = parseToISODate(startDate);
      if (!parsedStartDate) {
        return NextResponse.json(
          { message: "Invalid startDate. Provide a valid date." },
          { status: 400 }
        );
      }
    }
    if (endDate) {
      parsedEndDate = parseToISODate(endDate);
      if (!parsedEndDate) {
        return NextResponse.json(
          { message: "Invalid endDate. Provide a valid date." },
          { status: 400 }
        );
      }
    }

    let dataRows: any[] = [];

    if (parsedStartDate) {
      // Get the last available record for each index before the startDate using DISTINCT ON.
      const lastAvailableNavQuery = `
        SELECT DISTINCT ON (indices) indices, nav, date
        FROM public.tblresearch_new
        WHERE indices = ANY($1)
          AND date < $2::date
        ORDER BY indices, date DESC;
      `;
      const lastNavResult = await db.query(lastAvailableNavQuery, [
        indicesList,
        parsedStartDate,
      ]);

      // Create an interpolation row for each index that has a previous record.
      const interpolatedRows = lastNavResult.rows.map((row: any) => ({
        indices: row.indices,
        nav: row.nav,
        date: parsedStartDate, // Already in YYYY-MM-DD format.
      }));

      // Get all actual data from startDate onward (with an optional endDate filter)
      let mainQuery = `
        SELECT indices, nav, date
        FROM tblresearch_new
        WHERE indices = ANY($1)
          AND date >= $2::date
      `;
      const queryParams: any[] = [indicesList, parsedStartDate];

      // Use the next day for the end condition so that the entire endDate is included.
      if (parsedEndDate) {
        mainQuery += " AND date < ($3::date + INTERVAL '1 day')";
        queryParams.push(parsedEndDate);
      }
      mainQuery += " ORDER BY indices, date ASC;";

      const actualDataResult = await db.query(mainQuery, queryParams);

      // Combine the interpolation rows with the actual data.
      dataRows = [...interpolatedRows, ...actualDataResult.rows];
    } else {
      // If no startDate is provided, fetch all available data for the given indices.
      let mainQuery = `
        SELECT indices, nav, date
        FROM tblresearch_new
        WHERE indices = ANY($1)
      `;
      const queryParams: any[] = [indicesList];

      if (parsedEndDate) {
        mainQuery += " AND date < ($2::date + INTERVAL '1 day')";
        queryParams.push(parsedEndDate);
      }
      mainQuery += " ORDER BY indices, date ASC;";

      const result = await db.query(mainQuery, queryParams);
      dataRows = result.rows;
    }

    // Format each row's date as YYYY-MM-DD without additional timezone conversion.
    dataRows = dataRows.map((row: any) => ({
      ...row,
      date: dayjs(row.date).format("YYYY-MM-DD"),
    }));

    return NextResponse.json({ data: dataRows });
  } catch (error: any) {
    console.error("Error fetching indices:", error);
    return NextResponse.json(
      { message: "Error fetching indices data", error: error.message || String(error) },
      { status: 500 }
    );
  }
}

// Helper function to parse any date format into YYYY-MM-DD format.
// Returns null if the date cannot be parsed.
function parseToISODate(dateString: string): string | null {
  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().split("T")[0];
}