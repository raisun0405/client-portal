import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL('https://user-update.netlify.app'),
  title: {
    default: "My Project Portal | Client Dashboard",
    template: "%s | My Project Portal"
  },
  description: "Secure client portal to track project progress, feature requests, and financial status in real-time.",
  applicationName: "My Project Portal",
  keywords: ["client portal", "project management", "dashboard", "collaboration", "web development"],
  authors: [{ name: "Your Name" }],
  creator: "Your Name",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: "My Project Portal | Professional Client Dashboard",
    description: "Track your project lifecycle, payments, and features in one secure location.",
    siteName: "My Project Portal",
  },
  twitter: {
    card: "summary_large_image",
    title: "My Project Portal | Client Dashboard",
    description: "Track your project progress and financials in real-time.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={outfit.className}>
        {children}
      </body>
    </html>
  );
}
