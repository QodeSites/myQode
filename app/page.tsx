import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export default async function Home() {
  const cookieStore = await cookies()
  const isAuthed = cookieStore.get("qode-auth")?.value === "1"
  redirect(isAuthed ? "/portfolio/performance" : "/login")
}