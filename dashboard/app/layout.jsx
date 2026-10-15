import "./globals.css";

export const metadata = {
  title: "API Scout — API collection",
  description: "Connect a backend scanner and review discovered API endpoints.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
