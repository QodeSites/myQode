import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export default async function Home() {
  const cookieStore = await cookies()
  const isAuthed = !!cookieStore.get("qode-access-token")?.value
  redirect(isAuthed ? "/portfolio/performance" : "/login")
}