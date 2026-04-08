declare module "swagger-ui-react" {
  import React from "react";
  interface SwaggerUIProps {
    url?: string;
    spec?: object;
    layout?: string;
    docExpansion?: "list" | "full" | "none";
    defaultModelsExpandDepth?: number;
    tryItOutEnabled?: boolean;
    deepLinking?: boolean;
    [key: string]: unknown;
  }
  const SwaggerUI: React.ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}
