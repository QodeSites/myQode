import { cookies } from "next/headers"
import { redirect } from "next/navigation"

export default function Home() {
  const isAuthed = cookies().get("qode-auth")?.value === "1"
  redirect(isAuthed ? "/dashboard" : "/login")
}
