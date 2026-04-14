-- Add requiredDocuments and businessRules columns to comparison_templates
ALTER TABLE "comparison_templates" ADD COLUMN "requiredDocuments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "comparison_templates" ADD COLUMN "businessRules" JSONB NOT NULL DEFAULT '[]';

-- Migrate existing fields JSON: rename fieldName -> portalFieldName + documentFieldName
UPDATE comparison_templates
SET fields = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'portalFieldName', elem->>'fieldName',
      'documentFieldName', elem->>'fieldName',
      'mode', elem->>'mode',
      'tolerance', elem->'tolerance'
    )
  )
  FROM jsonb_array_elements(fields::jsonb) AS elem
)
WHERE jsonb_array_length(fields::jsonb) > 0;
