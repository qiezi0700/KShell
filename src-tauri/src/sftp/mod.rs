//! SFTP 子系统:在已连接的 SSH 会话上开 SFTP channel。
//!
//! 复用现有 SSH 会话(不新建连接),通过 channel_open_session + request_subsystem("sftp")
//! 拿到数据流,交给 russh_sftp::client::SftpSession 驱动。

pub mod commands;
pub mod local_scope;
pub mod session;

pub use session::SftpHandle;
