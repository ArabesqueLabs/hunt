use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    NotFound(String),
    /// The request can't be done as asked: a missing field, a bad date.
    #[error("{0}")]
    Invalid(String),
    /// It clashes with what's stored: a duplicate name, a record still in use.
    #[error("{0}")]
    Conflict(String),
    /// Fetching a page from elsewhere didn't work.
    #[error("{0}")]
    Fetch(String),
    #[error("this database wasn't made by this version of hunt ({0}); move it aside or pass --db")]
    ForeignDb(String),
    #[error("database: {0}")]
    Db(String),
    /// A row broke one of the database's rules: a duplicate, a reference
    /// to something missing or still in use.
    #[error("{message}")]
    Constraint {
        kind: Constraint,
        /// The column, when the database says.
        column: Option<String>,
        message: String,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Which rule a row broke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Constraint {
    Unique,
    ForeignKey,
    Other,
}

pub fn invalid(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}
