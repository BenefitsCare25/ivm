"use client";

import dynamic from "next/dynamic";

const SwaggerUILib = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => <div className="p-8 text-center">Loading API docs...</div>,
});

import "swagger-ui-react/swagger-ui.css";

interface SwaggerUIProps {
  url: string;
}

export function SwaggerUI({ url }: SwaggerUIProps) {
  return <SwaggerUILib url={url} docExpansion="list" deepLinking />;
}
