# Cross-Mark Transition Matrix

LC2 does not promise arbitrary shape morphing. It promises deterministic transition behavior.

| From | To | Required initial strategy |
|---|---|---|
| bar | bar | keyed geometry UPDATE |
| dot | dot | keyed position/radius UPDATE |
| arc | arc | keyed angle/radius UPDATE |
| line | line | series-level update; safe path morph or crossfade |
| area | area | series-level update; safe path morph or crossfade |
| bar | dot | bar collapse -> dot expand by shared datum key |
| dot | bar | dot collapse -> bar enter by shared datum key |
| bar | arc | bar EXIT/collapse -> arc sweep ENTER by shared datum key |
| arc | bar | arc collapse EXIT -> bar ENTER |
| bar | line | bars EXIT -> line series draw ENTER |
| line | bar | line EXIT -> bars ENTER |
| any unsupported pair | any | semantic EXIT old + ENTER new |

A hard instantaneous subtree swap is not an acceptable normal transition when both old and new states are valid and visible.
