import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="alert alert-error" style={{ margin: "2rem" }}>
          <strong>Something went wrong in this panel.</strong>
          <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.7 }}>
            {this.state.error?.message}
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: "0.75rem" }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
