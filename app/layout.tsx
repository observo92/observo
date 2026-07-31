import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ObservoBot from "@/components/ObservoBot";

export const metadata: Metadata = {
  title: "Observo — Powered by AI",
  description: "AI-powered timing heatmap for trading and launching tokens on Robinhood Chain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div className="atmosphere" />
        <ObservoBot />
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
