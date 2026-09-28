export const metadata = {
  title: 'Sign in',
  description: 'Sign in to myQode to see your Qode PMS portfolio, statements and requests.',
  alternates: { canonical: '/login' },
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
