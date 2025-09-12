import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PaymentSuccess() {
  return (
    <div className="w-full min-h-[calc(100vh-16rem)] flex flex-col justify-center items-center bg-background">
      <h1 className="text-primary text-4xl font-semibold">
        Thank you for making payment!
      </h1>
      <Link href="/experience/account-services">
        <Button className="bg-primary mt-4">
          Redirect to Account Services

        </Button>
      </Link>
    </div>
  );
}