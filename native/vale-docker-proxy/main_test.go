package main

import (
	"encoding/json"
	"testing"
)

func TestTranslateWorkspaceArgument(t *testing.T) {
	mappings := []pathMapping{{host: `C:\docs`, container: containerWorkspace}}
	got, added := translateArgument(`C:\docs\guide\intro.md`, mappings, 1)
	if got != "/workspace/guide/intro.md" || added != nil {
		t.Fatalf("got %q, mapping %#v", got, added)
	}
}

func TestTranslateExternalConfig(t *testing.T) {
	mappings := []pathMapping{{host: `C:\docs`, container: containerWorkspace}}
	got, added := translateArgument(`--config=C:\config\.vale.ini`, mappings, 1)
	if got != "--config=/vale-host/1/.vale.ini" || added == nil || added.host != `C:\config` {
		t.Fatalf("got %q, mapping %#v", got, added)
	}
}

func TestTranslateJSONPaths(t *testing.T) {
	input := []byte(`{"C": {"Path":"/workspace/guide.md"}, "/workspace/guide.md": []}`)
	output := translateJSONOutput(input, []pathMapping{{host: `C:\docs`, container: containerWorkspace}})
	var value map[string]any
	if err := json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value[`C:\docs\guide.md`]; !ok {
		t.Fatalf("translated key missing: %s", output)
	}
}
