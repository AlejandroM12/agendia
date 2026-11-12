import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Pantalla "en construcción", explícitamente identificada como tal.
 * Se usa para las secciones del dashboard cuya funcionalidad real todavía
 * no está implementada (ver docs/ROADMAP.md) — nunca para simular que una
 * funcionalidad está operativa cuando no lo está.
 */
export function PlaceholderPage({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <Badge variant="outline">{phase}</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Todavía en construcción</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
      </Card>
    </div>
  );
}
