

## Sidebar Design Auffrischung

### Geplante Verbesserungen

1. **Subtiler Gradient-Hintergrund** statt flachem `app-surface` - ein sanfter vertikaler Gradient, der zum bestehenden Primary-Farbschema passt

2. **Sektions-Header mit dezentem Icon** - "Projekte" und "Migrationen" Header bekommen kleine Icons (FolderOpen, Layers) für bessere visuelle Orientierung

3. **Hover-Effekte verfeinern** - Sanftere Transitions mit leichtem Scale-Effekt auf Migration-Items beim Hover

4. **Active-Item aufwerten** - Statt nur `border-l-2` ein abgerundeter Highlight mit sanftem Gradient-Background für das aktive Item

5. **Bottom-Section mit User-Info/Branding** - Ein dezenter Footer-Bereich am unteren Rand der Sidebar

6. **Collapse-Button mit Tooltip** - Besserer visueller Hint für den Collapse-Toggle

### Technische Umsetzung

**Sidebar.tsx Änderungen:**
- Logo-Bereich: Etwas mehr vertikaler Abstand, dezente Trennlinie darunter
- Sektions-Header: Icons hinzufügen (FolderOpen, Layers aus lucide-react)
- Migration-Items: Neue CSS-Klasse mit `transition-all duration-200` und subtiler `hover:translate-x-0.5` Bewegung
- Active-State: `bg-gradient-to-r from-primary/10 to-transparent` statt nur `bg-primary/5`
- "Neue Migration" Button: Pill-Style mit Primary-Farbe statt Ghost
- Divider: Von einfacher Border zu einem Gradient-Divider
- Footer: Dezenter Celion-Branding-Text am unteren Rand

**index.css Änderungen:**
- Keine neuen CSS-Klassen nötig, alles über Tailwind

