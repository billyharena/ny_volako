import { Component, type ReactNode } from 'react'

export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <p>Les graphiques sont indisponibles. Les montants restent consultables ci-dessous.</p> : this.props.children
  }
}
