"use client";

import SwaggerUILib from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

interface SwaggerUIProps {
  url: string;
}

export function SwaggerUI({ url }: SwaggerUIProps) {
  return <SwaggerUILib url={url} docExpansion="list" deepLinking />;
}
