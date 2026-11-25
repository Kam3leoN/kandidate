import { LitElement } from 'lit';

/** Light-DOM Lit element: global app styles + k3ui auto-registration see the content. */
export class LightElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}
