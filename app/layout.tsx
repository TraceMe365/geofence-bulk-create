import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wialon Geofence Manager",
  description: "Bulk-create geofences from a CSV, or view and export existing ones to Excel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
