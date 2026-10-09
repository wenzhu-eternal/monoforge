import { Button, Result } from 'antd'
import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { reportFrontendError } from '@/lib/error-reporter'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    // M12：被边界捕获的渲染错误不会冒泡到 window.onerror，此前仅 console.error 即监控盲区——
    // 统一按 js_error 上报（errorType 枚举无 render_error），组件栈入 context
    void reportFrontendError({
      source: 'frontend',
      errorType: 'js_error',
      message: `React 渲染错误: ${error.message}`,
      stack: error.stack,
      url: window.location.href,
      context: { componentStack: errorInfo.componentStack ?? undefined },
    })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={this.state.error?.message}
          extra={
            <Button type="primary" onClick={this.handleReset}>
              重试
            </Button>
          }
        />
      )
    }
    return this.props.children
  }
}
